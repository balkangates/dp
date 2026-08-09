// lib/catalog-admin.ts — modules/catalog-admin.js'in veri katmanının
// Next.js/React tarafına taşınmış hâli. DOM/innerHTML yok, sadece Supabase
// çağrıları — app/admin/page.tsx bunları state'e bağlıyor.
//
// Hiçbir hesaplama burada YAPILMAZ — hepsi migration'daki DB fonksiyonlarının
// (accept_product_suggestion, calculate_monthly_dealer_earnings, ...) ince
// bir istemci katmanı. Tek doğruluk kaynağı DB.
import { supabase } from './supabase';

export interface PendingCatalogProduct {
  id: string;
  name: string;
  suggested_price: number | null;
  categories: { name: string } | null;
}

export interface AdminCategory {
  id: string;
  name: string;
  commission_pct: number;
}

export interface PendingSuggestion {
  id: string;
  product_name: string;
  supplier_contact_info: string | null;
  stores: { name: string } | null;
  categories: { name: string } | null;
}

export interface CatalogOption {
  id: string;
  name: string;
}

export interface DealerEarning {
  id: string;
  store_id: string;
  period_year: number;
  period_month: number;
  gross_commission: number;
  referral_bonus: number;
  total_payable: number;
  payment_status: 'pending' | 'paid';
  payment_method: string | null;
  stores: { name: string } | null;
}

export async function fetchPendingCatalog(): Promise<PendingCatalogProduct[]> {
  const { data } = await supabase
    .from('catalog_products')
    .select('*, categories(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function fetchCategories(): Promise<AdminCategory[]> {
  const { data } = await supabase.from('categories').select('*').order('name');
  return data || [];
}

export async function fetchPendingSuggestions(): Promise<PendingSuggestion[]> {
  const { data } = await supabase
    .from('product_suggestions')
    .select('*, stores(name), categories(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function fetchCatalogForSelect(): Promise<CatalogOption[]> {
  const { data } = await supabase.from('catalog_products').select('id,name').eq('is_approved', true).order('name');
  return data || [];
}

export async function fetchEarnings(): Promise<DealerEarning[]> {
  const { data } = await supabase
    .from('dealer_earnings')
    .select('*, stores(name)')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  return data || [];
}

// Onayla: admin nihai satış fiyatını girer (supplier'ın önerisiyle aynı
// olabilir ya da değiştirilebilir) — status='approved' olunca
// sync_catalog_is_approved trigger'ı is_approved/is_active'i otomatik true yapar.
export async function approveCatalog(id: string, finalPrice: number, reviewedBy: string) {
  const { error } = await supabase
    .from('catalog_products')
    .update({ status: 'approved', suggested_price: finalPrice, reviewed_by: reviewedBy })
    .eq('id', id);
  if (error) throw error;
}

// Reddet: SİLMEZ — supplier'ın yeniden fiyat girip gönderebilmesi için
// status='rejected' + sebep kaydedilir. Supplier kendi panelinden
// (rejected sekmesi) yeni fiyatla tekrar 'pending'e çekebilir.
export async function rejectCatalog(id: string, reason: string, reviewedBy: string) {
  const { error } = await supabase
    .from('catalog_products')
    .update({ status: 'rejected', rejection_reason: reason, rejected_at: new Date().toISOString(), reviewed_by: reviewedBy })
    .eq('id', id);
  if (error) throw error;
}

export async function rejectSuggestion(id: string) {
  const { error } = await supabase
    .from('product_suggestions')
    .update({ status: 'rejected', resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function acceptSuggestion(suggestionId: string, catalogProductId: string) {
  const { error } = await supabase.rpc('accept_product_suggestion', {
    p_id: suggestionId,
    p_catalog_product_id: catalogProductId,
  });
  if (error) throw error;
}

export async function markEarningPaid(id: string, method: string) {
  const { error } = await supabase
    .from('dealer_earnings')
    .update({ payment_status: 'paid', payment_method: method, paid_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function updateCommissionRate(categoryId: string, pct: number) {
  const { error } = await supabase.from('categories').update({ commission_pct: pct }).eq('id', categoryId);
  if (error) throw error;
}

export function fmtMoney(n: number | null | undefined): string {
  return `₺${Number(n || 0).toLocaleString('tr-TR')}`;
}

export function monthLabel(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}
