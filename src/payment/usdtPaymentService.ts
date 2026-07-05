/**
 * src/payment/usdtPaymentService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * USDT Payment Module — gerçek Supabase şemasına göre düzenlenmiş
 *
 * Gerçek trade_payments kolönları:
 *   id, user_id, plan, amount_usdt, network, wallet_address,
 *   tx_hash, status (pending|confirmed|failed), confirmed_at,
 *   notes, memo (eklendi), created_at, updated_at
 *
 * expires_at YÖNTEMLE yönetilir (DB kolonu yok):
 *   created_at + 30 dk olarak hesaplanır.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabase }    from '../lib/supabase';
import { PLAN_META }   from '../subscription/subscriptionConfig';
import type { PlanId } from '../subscription/subscriptionConfig';

// ─── Sabitler ─────────────────────────────────────────────────────────────────

/** Platform TRC-20 USDT cüzdanı — gerçek adresle değiştir */
export const PLATFORM_WALLET = 'TJYourMasterUSDTWalletAddressHere';

const TRONSCAN_TX        = 'https://tronscan.org/#/transaction/';
const PAYMENT_EXPIRY_MS  = 30 * 60 * 1000;   // 30 dakika
export const POLL_INTERVAL_MS = 12_000;

// ─── Tipler ───────────────────────────────────────────────────────────────────

/** Gerçek tablodaki status değerleri */
export type PaymentStatus = 'pending' | 'confirmed' | 'failed';

/** UI akış durumu (DB'den bağımsız) */
export type PaymentFlowStatus = 'pending' | 'confirmed' | 'failed' | 'expired';

export interface WalletInfo {
  address: string;
  memo:    string;
  network: string;
}

export interface PaymentIntent {
  id:          string;
  userId:      string;
  plan:        PlanId;
  amountUsdt:  number;
  wallet:      WalletInfo;
  status:      PaymentStatus;
  expiresAt:   Date;         // created_at + 30dk (hesaplanmış)
  txHash:      string | null;
  tronscanUrl: string | null;
  createdAt:   string;
}

export interface PaymentResult {
  success: boolean;
  status:  PaymentFlowStatus;
  message: string;
}

// ─── Wallet Üretimi ───────────────────────────────────────────────────────────

export function generateWallet(userId: string): WalletInfo {
  // userId'nin son 8 hex karakterinden kısa numeric memo üret
  const memo = parseInt(userId.replace(/-/g, '').slice(-8), 16)
    .toString()
    .slice(0, 6);
  return {
    address: PLATFORM_WALLET,
    memo,
    network: 'TRC-20 (TRON)',
  };
}

// ─── Ödeme Kaydı Oluştur ──────────────────────────────────────────────────────

export async function createPaymentIntent(
  userId: string,
  plan: 'PRO' | 'VIP',
): Promise<{ data: PaymentIntent | null; error: string | null }> {
  const meta   = PLAN_META[plan];
  const wallet = generateWallet(userId);

  const { data, error } = await supabase
    .from('trade_payments')
    .insert({
      user_id:        userId,
      plan,
      amount_usdt:    meta.price,
      network:        'TRC20',
      wallet_address: wallet.address,
      memo:           wallet.memo,      // ek kolon (migration ile eklendi)
      status:         'pending',
      notes:          `Plan: ${plan} | Memo: ${wallet.memo}`,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[Payment] createPaymentIntent:', error);
    return { data: null, error: error?.message ?? 'Ödeme kaydı oluşturulamadı.' };
  }

  const expiresAt = new Date(new Date(data.created_at).getTime() + PAYMENT_EXPIRY_MS);

  return {
    data: {
      id:          data.id,
      userId,
      plan,
      amountUsdt:  meta.price,
      wallet,
      status:      'pending',
      expiresAt,
      txHash:      null,
      tronscanUrl: null,
      createdAt:   data.created_at,
    },
    error: null,
  };
}

// ─── TX Hash Gönder + Doğrula ─────────────────────────────────────────────────

export async function verifyPayment(args: {
  paymentId: string;
  txHash:    string;
  userId:    string;
}): Promise<PaymentResult> {
  const { paymentId, txHash, userId } = args;

  if (!txHash.trim()) {
    return { success: false, status: 'failed', message: 'TX hash boş olamaz.' };
  }

  // Kaydı yükle
  const { data: payment, error: loadErr } = await supabase
    .from('trade_payments')
    .select('*')
    .eq('id',      paymentId)
    .eq('user_id', userId)
    .single();

  if (loadErr || !payment) {
    return { success: false, status: 'failed', message: 'Ödeme kaydı bulunamadı.' };
  }

  if (payment.status === 'confirmed') {
    return { success: true, status: 'confirmed', message: 'Bu ödeme zaten onaylandı.' };
  }

  // Süre kontrolü (created_at + 30dk)
  const expiresAt = new Date(new Date(payment.created_at).getTime() + PAYMENT_EXPIRY_MS);
  if (new Date() > expiresAt) {
    await supabase
      .from('trade_payments')
      .update({ status: 'failed', notes: 'Süre doldu' })
      .eq('id', paymentId);
    return { success: false, status: 'expired', message: 'Ödeme süresi doldu. Lütfen yeniden başlatın.' };
  }

  // Replay protection: aynı tx_hash başka kayıtta var mı?
  const { data: existing } = await supabase
    .from('trade_payments')
    .select('id')
    .eq('tx_hash', txHash.trim())
    .neq('id',     paymentId)
    .maybeSingle();

  if (existing) {
    return { success: false, status: 'failed', message: 'Bu TX hash başka bir ödemede kullanılmış.' };
  }

  // TX hash formatını doğrula (mock)
  const onChain = await _verifyOnChain(txHash.trim());
  if (!onChain.valid) {
    await supabase
      .from('trade_payments')
      .update({ tx_hash: txHash.trim(), status: 'failed' })
      .eq('id', paymentId);
    return { success: false, status: 'failed', message: onChain.reason ?? 'TX doğrulaması başarısız.' };
  }

  // Ödemeyi onayla
  await supabase
    .from('trade_payments')
    .update({
      tx_hash:      txHash.trim(),
      status:       'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', paymentId);

  // Aboneliği aktif et
  const subResult = await activateSubscription(userId, payment.plan as PlanId);
  if (!subResult.success) {
    return {
      success: false,
      status:  'confirmed',
      message: 'Ödeme onaylandı fakat abonelik aktif edilemedi. Destek ekibiyle iletişime geçin.',
    };
  }

  return {
    success: true,
    status:  'confirmed',
    message: `${PLAN_META[payment.plan as PlanId].badge} planınız aktif edildi!`,
  };
}

// ─── Abonelik Aktifleştir ─────────────────────────────────────────────────────

export async function activateSubscription(
  userId:      string,
  plan:        PlanId,
  durationDays = 30,
): Promise<{ success: boolean; error?: string }> {
  const expiresAt = new Date(
    Date.now() + durationDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // trade_subscriptions unique index: user_id
  const { error } = await supabase
    .from('trade_subscriptions')
    .upsert(
      {
        user_id:    userId,
        plan,
        status:     'active',
        expires_at: expiresAt,
        auto_renew: false,
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    console.error('[Payment] activateSubscription:', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}

// ─── Durum Sorgula ────────────────────────────────────────────────────────────

export async function getPaymentStatus(
  paymentId: string,
  userId:    string,
): Promise<PaymentFlowStatus> {
  const { data } = await supabase
    .from('trade_payments')
    .select('status, created_at')
    .eq('id',      paymentId)
    .eq('user_id', userId)
    .single();

  if (!data) return 'failed';
  if (data.status === 'confirmed') return 'confirmed';
  if (data.status === 'failed')    return 'failed';

  // pending: süre dolmuş mu?
  const expiresAt = new Date(new Date(data.created_at).getTime() + PAYMENT_EXPIRY_MS);
  if (new Date() > expiresAt) {
    await supabase
      .from('trade_payments')
      .update({ status: 'failed', notes: 'Süre doldu' })
      .eq('id', paymentId);
    return 'expired';
  }

  return 'pending';
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────────

async function _verifyOnChain(txHash: string): Promise<{ valid: boolean; reason?: string }> {
  // MOCK: TRC-20 hash = 64 hex karakter
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) {
    return {
      valid:  false,
      reason: 'Geçersiz TX hash formatı. TRC-20 işlem kimliği 64 hex karakter olmalıdır.',
    };
  }
  // Gerçek entegrasyon için:
  // const res = await fetch(`https://api.trongrid.io/v1/transactions/${txHash}`, ...)
  await new Promise(r => setTimeout(r, 600));
  return { valid: true };
}

export function buildTronscanUrl(txHash: string)          { return `${TRONSCAN_TX}${txHash}`; }

export function formatCountdown(expiresAt: Date): string {
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return '00:00';
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
