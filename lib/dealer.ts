// lib/dealer.ts — dashboard.html → modules/live-sales.js'in veri katmanının
// Next.js/React tarafına taşınmış hâli. DOM manipülasyonu yok, sadece
// Supabase çağrıları — React bileşenleri bunları state'e bağlıyor.
import { supabase, SUPABASE_URL } from './supabase';

export interface Store {
  id: string;
  owner_id: string;
  name: string;
  is_live: boolean;
  status: string;
  dealer_status: string;
  login_disabled: boolean;
  dashboard_locked: boolean;
  spotlight_product_id: string | null;
  [key: string]: unknown;
}

export async function ensureStore(ownerId: string): Promise<Store | null> {
  const { data } = await supabase.from('stores').select('*').eq('owner_id', ownerId).maybeSingle();
  return data;
}

export async function createStore(ownerId: string, name: string): Promise<Store> {
  const { data, error } = await supabase
    .from('stores')
    .insert({ owner_id: ownerId, name, status: 'active' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function loadDashboardStatus(storeId: string) {
  const { data, error } = await supabase.rpc('get_dealer_dashboard_status', { p_store_id: storeId });
  if (error) {
    console.error('[dealer] dashboard status hatası:', error);
    return null;
  }
  return data;
}

export async function loadDealerProducts(storeId: string) {
  const { data } = await supabase
    .from('store_products')
    .select('*, product_videos(id, video_url, created_at)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });
  return data || [];
}

// escrow_transactions/store_order_invoices/delivery_notes: order_id üzerinden
// store_orders'a FK'lı oldukları için PostgREST bunları otomatik embed
// edebiliyor (fix_order_finance_engine.sql çalıştırılmış olmalı).
export async function loadRecentOrders(storeId: string) {
  const { data } = await supabase
    .from('store_orders')
    .select('*, store_order_items(*), escrow_transactions(status, net_amount), store_order_invoices(invoice_number), delivery_notes(document_no)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(10);
  return data || [];
}

export const NEXT_STATUS: Record<string, string> = {
  PAYMENT_PENDING: 'CONFIRMED',
  CONFIRMED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'SHIPPED',
  SHIPPED: 'DELIVERED',
  DELIVERED: 'COMPLETED',
};

export const STATUS_LABEL: Record<string, string> = {
  PAYMENT_PENDING: 'Ödeme Bekliyor',
  CONFIRMED: 'Onaylandı',
  PREPARING: 'Hazırlanıyor',
  READY: 'Hazır',
  SHIPPED: 'Kargoda',
  DELIVERED: 'Teslim Edildi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
};

export async function advanceOrder(orderId: string, nextStatus: string) {
  const { error } = await supabase.from('store_orders').update({ status: nextStatus }).eq('id', orderId);
  if (error) throw error;
}

export async function cancelOrder(orderId: string) {
  const { error } = await supabase.from('store_orders').update({ status: 'CANCELLED' }).eq('id', orderId);
  if (error) throw error;
}

export async function toggleLiveSession(storeId: string, currentlyLive: boolean) {
  if (currentlyLive) {
    const { error } = await supabase.rpc('end_live_session', { p_store_id: storeId });
    if (error) throw error;
  } else {
    const { error } = await supabase.rpc('start_live_session', { p_store_id: storeId });
    if (error) throw error;
  }
}

export function explainBlockReason(message: string): string {
  if (message.includes('SUSPENDED')) return 'Bayiliğiniz askıya alındığı için canlıya geçemezsiniz.';
  if (message.includes('NO_ACTIVE_CATEGORY')) return 'Canlıya geçmek için en az 1 AKTİF kategoriniz olmalı (kategori ürünlerinin en az %20\'sini seçmelisiniz).';
  if (message.includes('NO_VIDEO_PRODUCT')) return 'Canlıya geçmek için en az 1 ürününüze YouTube tanıtım video linki eklemiş olmalısınız.';
  return 'Canlıya geçilemedi: ' + message;
}

// DIŞ BAĞIMLILIK: supabase/functions/live-token deploy edilmiş olmalı.
export async function fetchPublisherToken(storeId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/live-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData?.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ store_id: storeId }),
  });
  const payload = await resp.json();
  if (!resp.ok) throw new Error(payload.error || 'Yayın token alınamadı');
  return payload as { token: string; ws_url: string; room: string };
}
