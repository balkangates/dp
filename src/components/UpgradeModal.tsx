/**
 * UpgradeModal.tsx  — PRODUCTION EDITION
 * ─────────────────────────────────────────────────────────────────────────────
 * Full 4-step USDT payment flow:
 *   Step 1 → Plan picker   (PRO vs VIP)
 *   Step 2 → Payment QR    (wallet address, memo, amount, countdown)
 *   Step 3 → TX submit     (user pastes TX hash → verifyPayment())
 *   Step 4 → Confirmed     (success screen with TronScan link)
 *
 * Wired to:
 *   usePayment()       – full payment lifecycle hook
 *   useSubscription()  – refreshes plan after activation
 *   PLAN_META          – prices, features, colors
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence }     from 'framer-motion';
import { PLAN_META, type PlanId }      from '../subscription/subscriptionConfig';
import { usePayment }                  from '../payment/usePayment';

interface UpgradeModalProps {
  open:        boolean;
  onClose:     () => void;
  onSuccess:   () => void;
  defaultPlan?: PlanId;
}

// ── small helpers ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      style={{
        background:   '#0D1525',
        border:       '1px solid #2A3650',
        color:        copied ? '#10B981' : '#A3B3D1',
        borderRadius: 7,
        padding:      '4px 10px',
        fontSize:     11,
        cursor:       'pointer',
        fontFamily:   "'Courier New', monospace",
        transition:   'color .2s',
      }}
    >
      {copied ? '✓ Kopyalandı' : '📋 Kopyala'}
    </button>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#131C2C', border: '1px solid #2A3650', borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: '#5E7090', fontFamily: "'Courier New', monospace", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#D4AF37', wordBreak: 'break-all' }}>{value}</span>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UpgradeModal({ open, onClose, onSuccess, defaultPlan = 'PRO' }: UpgradeModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<'PRO' | 'VIP'>(
    defaultPlan === 'VIP' ? 'VIP' : 'PRO'
  );
  const [txHashInput, setTxHash] = useState('');
  const txRef = useRef<HTMLInputElement>(null);

  const payment = usePayment((plan) => {
    console.log('[UpgradeModal] subscription activated:', plan);
    onSuccess();
  });

  // Reset everything when modal closes
  useEffect(() => {
    if (!open) {
      payment.reset();
      setTxHash('');
    }
  }, [open]);

  // Auto-focus TX input when step changes
  useEffect(() => {
    if (payment.flowState === 'awaiting_tx') {
      setTimeout(() => txRef.current?.focus(), 300);
    }
  }, [payment.flowState]);

  if (!open) return null;

  const meta         = PLAN_META[selectedPlan];
  const isPickStep   = payment.flowState === 'idle' || payment.flowState === 'creating';
  const isPayStep    = payment.flowState === 'awaiting_tx' || payment.flowState === 'verifying';
  const isDone       = payment.flowState === 'confirmed';
  const isFailed     = payment.flowState === 'failed';
  const isExpired    = payment.flowState === 'expired';

  function handleClose() {
    payment.reset();
    setTxHash('');
    onClose();
  }

  async function handleStartPayment() {
    await payment.start(selectedPlan);
  }

  async function handleSubmitTx() {
    await payment.submit(txHashInput);
  }

  // ── Layout ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(5px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <motion.div
        initial={{ scale: .92, opacity: 0, y: 16 }}
        animate={{ scale: 1,   opacity: 1, y: 0  }}
        transition={{ type: 'spring', damping: 22, stiffness: 280 }}
        style={{ background: '#0D1525', border: '1px solid #2A3650', borderRadius: 20, width: '100%', maxWidth: 500, maxHeight: '92vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #2A3650', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: 8 }}>
            {isDone ? '🎉' : isExpired ? '⏰' : isFailed ? '⚠️' : '💎'}
            {isDone ? 'Abonelik Aktif!' : isExpired ? 'Süre Doldu' : isFailed ? 'Hata' : 'Planı Yükselt'}
          </span>
          {/* Step dots */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[0, 1, 2].map(i => {
              const active = isPickStep ? i === 0 : isPayStep ? i === 1 : i === 2;
              const done   = isPickStep ? false : isPayStep ? i === 0 : i <= 1;
              return (
                <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: done ? '#10B981' : active ? '#D4AF37' : '#2A3650', transition: 'background .3s' }} />
              );
            })}
            <button onClick={handleClose} style={{ background: 'none', border: 'none', color: '#5E7090', cursor: 'pointer', fontSize: 20, marginLeft: 8 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: 20 }}>

          {/* ── STEP 1: Plan picker ─────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {isPickStep && (
              <motion.div key="pick" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  {(['PRO', 'VIP'] as const).map(pid => {
                    const m      = PLAN_META[pid];
                    const active = selectedPlan === pid;
                    return (
                      <button
                        key={pid}
                        onClick={() => setSelectedPlan(pid)}
                        style={{ background: active ? `${m.color}10` : '#131C2C', border: `2px solid ${active ? m.color : '#2A3650'}`, borderRadius: 14, padding: 16, cursor: 'pointer', textAlign: 'left', transition: 'all .15s', color: '#E2E8F0' }}
                      >
                        <div style={{ color: m.color, fontWeight: 900, fontSize: 15, marginBottom: 4 }}>{m.badge}</div>
                        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 24, fontWeight: 900, marginBottom: 10 }}>
                          ${m.price} <span style={{ fontSize: 11, color: '#5E7090' }}>USDT/ay</span>
                        </div>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 11, color: '#A3B3D1', lineHeight: 2 }}>
                          {m.features.map(f => <li key={f}><span style={{ color: m.color, marginRight: 5 }}>✓</span>{f}</li>)}
                        </ul>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={handleStartPayment}
                  disabled={payment.loading}
                  style={{ width: '100%', background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', border: 'none', borderRadius: 12, padding: '13px 20px', fontSize: 14, fontWeight: 700, cursor: payment.loading ? 'wait' : 'pointer', opacity: payment.loading ? .7 : 1 }}
                >
                  {payment.loading ? '⏳ Hazırlanıyor…' : `Devam Et → ${meta.badge} $${meta.price} USDT`}
                </button>
              </motion.div>
            )}

            {/* ── STEP 2: Payment details + TX hash ───────────────────── */}
            {isPayStep && payment.intent && (
              <motion.div key="pay" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                {/* Amount banner */}
                <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#A3B3D1' }}>Göndermeniz gereken miktar:</span>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 22, fontWeight: 900, color: '#10B981' }}>
                    ${payment.intent.amountUsdt} <span style={{ fontSize: 12, color: '#5E7090' }}>USDT</span>
                  </span>
                </div>

                {/* Countdown */}
                <div style={{ textAlign: 'center', marginBottom: 14 }}>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 28, fontWeight: 900, color: payment.countdown < '05:00' ? '#EF4444' : '#F59E0B' }}>
                    ⏱ {payment.countdown}
                  </span>
                  <div style={{ fontSize: 11, color: '#5E7090', marginTop: 2 }}>kalan süre</div>
                </div>

                {/* Wallet fields */}
                <FieldRow label="USDT GÖNDERİLECEK ADRES (TRC-20)" value={payment.intent.wallet.address} />
                <FieldRow label="MEMO / TAG (zorunlu — eşleştirme için)" value={payment.intent.wallet.memo} />

                <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#F59E0B', marginBottom: 16, fontFamily: "'Courier New', monospace" }}>
                  ⚠️ MEMO alanını boş bırakmayın — olmadan ödemeniz eşleştirilemez!
                </div>

                {/* TX hash input */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 10, color: '#5E7090', fontFamily: "'Courier New', monospace", fontWeight: 700, marginBottom: 6 }}>
                    ÖDEME SONRASI TX HASH (İşlem Kimliği)
                  </label>
                  <input
                    ref={txRef}
                    value={txHashInput}
                    onChange={e => { setTxHash(e.target.value); }}
                    placeholder="64 karakterli TRC-20 TX hash yapıştırın…"
                    style={{ width: '100%', background: 'rgba(7,11,20,.8)', border: '1px solid #2A3650', borderRadius: 10, padding: '10px 12px', color: '#E2E8F0', fontSize: 13, fontFamily: "'Courier New', monospace", outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Error */}
                {payment.error && (
                  <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#EF4444', marginBottom: 14, fontFamily: "'Courier New', monospace" }}>
                    {payment.error}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => { payment.reset(); }}
                    style={{ flex: 1, background: '#131C2C', border: '1px solid #2A3650', color: '#A3B3D1', borderRadius: 10, padding: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ← Geri
                  </button>
                  <button
                    onClick={handleSubmitTx}
                    disabled={payment.loading || !txHashInput.trim()}
                    style={{ flex: 3, background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', border: 'none', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 700, cursor: payment.loading || !txHashInput.trim() ? 'not-allowed' : 'pointer', opacity: payment.loading || !txHashInput.trim() ? .55 : 1 }}
                  >
                    {payment.loading ? '⏳ Doğrulanıyor…' : '✓ Ödemeyi Onayla'}
                  </button>
                </div>

                <p style={{ fontSize: 11, color: '#5E7090', textAlign: 'center', marginTop: 12, fontFamily: "'Courier New', monospace" }}>
                  Ödeme yaptıktan sonra TX hash'i girin — sistem otomatik doğrular.
                </p>
              </motion.div>
            )}

            {/* ── STEP 3: Confirmed ───────────────────────────────────────── */}
            {isDone && (
              <motion.div key="done" initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: '#E2E8F0', marginBottom: 8 }}>
                  {PLAN_META[selectedPlan].badge} Planınız Aktif!
                </h3>
                <p style={{ fontSize: 13, color: '#A3B3D1', lineHeight: 1.7, marginBottom: 20 }}>
                  Ödemeniz doğrulandı. Gerçek zamanlı sinyallere şimdi erişebilirsiniz.
                </p>
                {payment.tronscanUrl && (
                  <a
                    href={payment.tronscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#38BDF8', textDecoration: 'none', marginBottom: 20, fontFamily: "'Courier New', monospace" }}
                  >
                    <i className="fas fa-external-link" /> TronScan'da Görüntüle
                  </a>
                )}
                <br />
                <button
                  onClick={handleClose}
                  style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', border: 'none', borderRadius: 12, padding: '12px 32px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  Harika, başla →
                </button>
              </motion.div>
            )}

            {/* ── Expired / Failed recovery ──────────────────────────────── */}
            {(isExpired || isFailed) && (
              <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>{isExpired ? '⏰' : '❌'}</div>
                <p style={{ fontSize: 13, color: '#A3B3D1', marginBottom: 20 }}>
                  {payment.error || (isExpired ? 'Süre doldu.' : 'Doğrulama başarısız.')}
                </p>
                <button
                  onClick={() => payment.reset()}
                  style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', border: 'none', borderRadius: 12, padding: '10px 28px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  Yeniden Dene
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
