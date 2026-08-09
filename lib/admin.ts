// lib/admin.ts — modules/catalog-admin.js'in veri katmanının Next.js
// tarafına taşınmış hâli + Faz 5'te eklenen ihale kazananı onay akışı.
import { supabase } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

// ── Katalog ürün onayı (tedarikçi önerileri) ────────────────────────────
export async function loadPendingCatalogProducts(): Promise<AnyRow[]> {
  const { data } = await supabase
    .from('catalog_products')
    .select('*, categories(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function approveCatalogProduct(id: string) {
  const { error } = await supabase
    .from('catalog_products')
    .update({ status: 'approved', is_approved: true })
    .eq('id', id);
  if (error) throw error;
}

export async function rejectCatalogProduct(id: string) {
  const { error } = await supabase
    .from('catalog_products')
    .update({ status: 'rejected', is_approved: false })
    .eq('id', id);
  if (error) throw error;
}

// ── Kategori komisyon oranları ───────────────────────────────────────────
export async function loadCategories(): Promise<AnyRow[]> {
  const { data } = await supabase.from('categories').select('*').order('name');
  return data || [];
}

export async function updateCommissionPct(categoryId: string, pct: number) {
  const { error } = await supabase.from('categories').update({ commission_pct: pct }).eq('id', categoryId);
  if (error) throw error;
}

// ── Bayi ürün önerileri (product_suggestions) ────────────────────────────
export async function loadPendingSuggestions(): Promise<AnyRow[]> {
  const { data } = await supabase
    .from('product_suggestions')
    .select('*, stores(name), categories(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function acceptSuggestion(suggestionId: string, catalogProductId: string) {
  const { error } = await supabase.rpc('accept_product_suggestion', {
    p_id: suggestionId,
    p_catalog_product_id: catalogProductId,
  });
  if (error) throw error;
}

export async function rejectSuggestion(id: string) {
  const { error } = await supabase
    .from('product_suggestions')
    .update({ status: 'rejected', resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function loadApprovedCatalogNames(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from('catalog_products').select('id,name').eq('is_approved', true).order('name');
  return data || [];
}

// ── Bayi hakediş (komisyon) ödemeleri ────────────────────────────────────
export async function loadDealerEarnings(): Promise<AnyRow[]> {
  const { data } = await supabase
    .from('dealer_earnings')
    .select('*, stores(name)')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  return data || [];
}

export async function markEarningPaid(id: string, method: string) {
  const { error } = await supabase
    .from('dealer_earnings')
    .update({ payment_status: 'paid', payment_method: method, paid_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ── FAZ 5: İhale kazananı onayı ───────────────────────────────────────────
export async function loadResolvableAuctions(): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from('reverse_auctions')
    .select('*, supplier_bids(id, supplier_id, unit_price, status, profiles(company_name, full_name))')
    .in('status', ['active', 'closed'])
    .order('end_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function closeExpiredAuctions(): Promise<number> {
  const { data, error } = await supabase.rpc('close_expired_auctions');
  if (error) throw error;
  return data as number;
}

export async function approveAuctionWinner(auctionId: string) {
  const { error } = await supabase.rpc('admin_approve_auction_winner', { p_auction_id: auctionId });
  if (error) throw error;
}

export async function cancelAuction(auctionId: string, reason?: string) {
  const { error } = await supabase.rpc('admin_cancel_auction', { p_auction_id: auctionId, p_reason: reason ?? null });
  if (error) throw error;
}

// ── Muhasebe özeti (mağaza bazlı) ────────────────────────────────────────
export async function loadFinanceSummary(): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from('v_admin_finance_summary')
    .select('*')
    .order('gross_sales', { ascending: false });
  if (error) throw error;
  return data || [];
}
