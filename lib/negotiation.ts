// lib/negotiation.ts — Faz 3: birebir görüntülü görüşme sinyalleşmesi
// (call_requests) + fiyat pazarlığı (negotiation_offers).
import { supabase, SUPABASE_URL } from './supabase';

export interface CallRequest {
  id: string;
  store_id: string;
  customer_id: string;
  status: 'requested' | 'accepted' | 'rejected' | 'ended' | 'missed';
  room_name: string;
  requested_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export async function requestCall(storeId: string, customerId: string): Promise<CallRequest> {
  const roomName = `call-pending-${crypto.randomUUID()}`;
  const { data, error } = await supabase
    .from('call_requests')
    .insert({ store_id: storeId, customer_id: customerId, room_name: roomName })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function acceptCall(callId: string) {
  const { error } = await supabase
    .from('call_requests')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', callId);
  if (error) throw error;
}

export async function rejectCall(callId: string) {
  const { error } = await supabase.from('call_requests').update({ status: 'rejected' }).eq('id', callId);
  if (error) throw error;
}

export async function endCall(callId: string) {
  const { error } = await supabase
    .from('call_requests')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', callId);
  if (error) throw error;
}

export async function getCallToken(callRequestId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/live-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData?.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ role: 'call', call_request_id: callRequestId }),
  });
  const payload = await resp.json();
  if (!resp.ok) throw new Error(payload.error || 'Görüşme token\u2019ı alınamadı');
  return payload as { token: string; ws_url: string; room: string };
}

// ── Fiyat pazarlığı ────────────────────────────────────────────────────
export interface NegotiationOffer {
  id: string;
  store_product_id: string;
  customer_id: string;
  quantity: number;
  offered_unit_price: number;
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'expired';
  counter_price: number | null;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export async function submitOffer(params: {
  storeProductId: string;
  customerId: string;
  quantity: number;
  offeredUnitPrice: number;
  callRequestId?: string;
}) {
  const { error } = await supabase.from('negotiation_offers').insert({
    store_product_id: params.storeProductId,
    customer_id: params.customerId,
    quantity: params.quantity,
    offered_unit_price: params.offeredUnitPrice,
    call_request_id: params.callRequestId ?? null,
  });
  if (error) throw error;
}

export async function getMyOffers(customerId: string) {
  const { data, error } = await supabase
    .from('negotiation_offers')
    .select('*, store_products(name)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function getStoreOffers(storeId: string) {
  // negotiation_offers, store_products üzerinden store_id'ye bağlı —
  // doğrudan store_id kolonu yok, bu yüzden inner join filtresi kullanılıyor.
  const { data, error } = await supabase
    .from('negotiation_offers')
    .select('*, store_products!inner(name, store_id, price), profiles(full_name, company_name)')
    .eq('store_products.store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

export async function respondToOffer(offerId: string, action: 'accepted' | 'rejected' | 'countered', counterPrice?: number) {
  const { error } = await supabase
    .from('negotiation_offers')
    .update({
      status: action,
      counter_price: action === 'countered' ? counterPrice : null,
      responded_at: new Date().toISOString(),
    })
    .eq('id', offerId);
  if (error) throw error;
}

export async function acceptCounter(offerId: string, counterPrice: number) {
  const { error } = await supabase
    .from('negotiation_offers')
    .update({ status: 'accepted', offered_unit_price: counterPrice, responded_at: new Date().toISOString() })
    .eq('id', offerId);
  if (error) throw error;
}
