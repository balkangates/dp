// lib/supplier.ts — modules/supplier.js'in veri katmanının Next.js/React
// tarafına taşınmış hâli. DOM/innerHTML yok, sadece Supabase çağrıları —
// app/supplier/page.tsx bunları state'e bağlıyor.
//
// MODÜL 3.6 (Stok, Faturalama, Komisyon) eklentileri — supabase_migration_
// v4_supplier_commission.sql'e bağlı:
//   - Stok Yönetimi   → product_variants (renk/beden/model + adet). Stok=0
//     olan varyantların toplamı sıfırlanınca catalog_products.is_active ve
//     TÜM bayilerin store_products.is_active'i DB TRIGGER'I ile otomatik
//     kapanır — burada sadece stok adedi güncellenir, kapatma/açma mantığı
//     istemci tarafında YOK (tek doğruluk kaynağı DB).
//   - Yeni Ürün Öner  → catalog_products'a is_approved=false ile INSERT
//     (RLS bunu zorluyor — tedarikçi kendi ürününü asla onaylı ekleyemez).
//   - Eksik Siparişler → supplier_order_shortfalls, sadece OKUMA + "Tamamladım"
//     (mark_shortfall_resolved RPC'si).
import { supabase } from './supabase';

export interface ProductVariant {
  id: string;
  catalog_product_id: string;
  color: string | null;
  size: string | null;
  model: string | null;
  stock_qty: number;
}

export interface SupplierCatalogProduct {
  id: string;
  name: string;
  suggested_price: number | null;
  is_approved: boolean;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  product_variants: ProductVariant[];
}

export interface ReverseAuction {
  id: string;
  product_name: string;
  total_quantity: number;
  quantity_unit: string;
  ceiling_price: number;
  end_time: string;
}

export interface SupplierBid {
  id: string;
  unit_price: number;
  status: string;
  created_at: string;
  reverse_auctions: { product_name: string; ceiling_price: number; status: string } | null;
}

export interface SupplierShipment {
  id: string;
  status: string;
  tracking_note: string | null;
  updated_at: string;
  reverse_auctions: { product_name: string } | null;
}

export interface Sector {
  id: string;
  label: string;
}

export interface SupplierCategory {
  id: string;
  name: string;
  sector_id: string | null;
}

export interface Subcategory {
  id: string;
  name: string;
  category_id: string;
}

export interface Shortfall {
  id: string;
  shortfall_qty: number;
  deadline_at: string;
  penalty_points: number;
  status: string;
  catalog_products: { name: string } | null;
}

export interface SupplierStats {
  totalProducts: number;
  approved: number;
  pending: number;
  incomingOrders: number;
  revenue: number;
}

// Önceden BÜTÜN platformdaki bütün aktif reverse_auctions'lar HER
// tedarikçiye gösteriliyordu — kendi ürün kategorisiyle hiç alakası olmayan
// talepler dahil. reverse_auctions.catalog_product_id, hangi onaylı ürüne
// ait olduğunu tutuyor — artık sadece KENDİ kataloğundaki ürünlerle eşleşen
// (+ henüz bir ürüne bağlanmamış/eski, catalog_product_id NULL olan)
// talepler gösteriliyor.
export async function fetchOpenAuctions(myCatalogProducts: SupplierCatalogProduct[]): Promise<ReverseAuction[]> {
  const myProductIds = myCatalogProducts.map((p) => p.id);
  let query = supabase.from('reverse_auctions').select('*').eq('status', 'active');
  query = myProductIds.length > 0
    ? query.or(`catalog_product_id.in.(${myProductIds.join(',')}),catalog_product_id.is.null`)
    : query.is('catalog_product_id', null);
  const { data, error } = await query.order('end_time', { ascending: true });
  if (error) {
    console.error('[supplier] ihaleler yüklenemedi:', error);
    return [];
  }
  return data || [];
}

export async function fetchMyBids(supplierId: string): Promise<SupplierBid[]> {
  const { data } = await supabase
    .from('supplier_bids')
    .select('*, reverse_auctions(product_name, ceiling_price, status)')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function fetchMyShipments(supplierId: string): Promise<SupplierShipment[]> {
  const { data } = await supabase
    .from('shipments')
    .select('*, reverse_auctions(product_name)')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function fetchMyCatalogProducts(supplierId: string): Promise<SupplierCatalogProduct[]> {
  const { data } = await supabase
    .from('catalog_products')
    .select('*, product_variants(*)')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function fetchSectors(): Promise<Sector[]> {
  const { data } = await supabase.from('sectors').select('id,label').eq('is_active', true).order('sort_order');
  return data || [];
}

export async function fetchCategories(): Promise<SupplierCategory[]> {
  const { data } = await supabase.from('categories').select('id,name,sector_id').eq('is_active', true).order('name');
  return data || [];
}

export async function fetchSubcategories(): Promise<Subcategory[]> {
  const { data } = await supabase.from('subcategories').select('id,name,category_id').eq('is_active', true).order('name');
  return data || [];
}

export async function fetchMyShortfalls(supplierId: string): Promise<Shortfall[]> {
  const { data } = await supabase
    .from('supplier_order_shortfalls')
    .select('*, catalog_products(name)')
    .eq('supplier_id', supplierId)
    .order('deadline_at', { ascending: true });
  return data || [];
}

export async function addVariant(
  catalogProductId: string,
  color: string,
  size: string,
  model: string,
  stockQty: number,
) {
  const { error } = await supabase.from('product_variants').insert({
    catalog_product_id: catalogProductId,
    color: color || null,
    size: size || null,
    model: model || null,
    stock_qty: stockQty,
  });
  if (error) throw error;
}

export async function updateVariantStock(variantId: string, newQty: number) {
  const { error } = await supabase.from('product_variants').update({ stock_qty: newQty }).eq('id', variantId);
  if (error) throw error;
}

export async function proposeNewProduct(
  supplierId: string,
  payload: { name: string; category_id: string; subcategory_id: string | null; suggested_price: number },
) {
  const { error } = await supabase.from('catalog_products').insert({
    ...payload,
    supplier_id: supplierId,
    is_approved: false,
    is_active: false,
  });
  if (error) throw error;
}

// Reddedilen bir ürüne yeni fiyat girip yeniden admin onayına gönderir.
// RLS: supplier sadece KENDİ status='rejected' satırını status='pending'e
// çekebilir — başka bir supplier'ın ya da zaten onaylanmış bir ürünün
// fiyatını değiştiremez.
export async function resubmitPrice(catalogProductId: string, newPrice: number, supplierId: string) {
  const { error } = await supabase
    .from('catalog_products')
    .update({ suggested_price: newPrice, status: 'pending' })
    .eq('id', catalogProductId)
    .eq('supplier_id', supplierId);
  if (error) throw error;
}

export async function resolveShortfall(id: string) {
  const { error } = await supabase.rpc('mark_shortfall_resolved', { p_id: id });
  if (error) throw error;
}

export async function submitBid(auctionId: string, supplierId: string, price: number, notes: string) {
  const { error } = await supabase.from('supplier_bids').insert({
    auction_id: auctionId,
    supplier_id: supplierId,
    unit_price: price,
    notes: notes || null,
  });
  if (error) throw error;
}

export async function fetchSupplierStats(myCatalogProducts: SupplierCatalogProduct[]): Promise<SupplierStats> {
  const totalProducts = myCatalogProducts.length;
  const approved = myCatalogProducts.filter((p) => p.is_approved).length;
  const pending = totalProducts - approved;

  // Gelen sipariş + ciro: bu tedarikçinin ürünlerini içeren store_order_items
  const catalogIds = myCatalogProducts.map((p) => p.id);
  let incomingOrders = 0;
  let revenue = 0;
  if (catalogIds.length > 0) {
    const { data: storeProductRows } = await supabase.from('store_products').select('id').in('catalog_product_id', catalogIds);
    const storeProductIds = (storeProductRows || []).map((r: { id: string }) => r.id);
    if (storeProductIds.length > 0) {
      const { data: items } = await supabase.from('store_order_items').select('total_price').in('store_product_id', storeProductIds);
      incomingOrders = (items || []).length;
      revenue = (items || []).reduce((s: number, i: { total_price: number }) => s + Number(i.total_price || 0), 0);
    }
  }
  return { totalProducts, approved, pending, incomingOrders, revenue };
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const STATUS_TAG_COLOR: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#38BDF820', fg: '#38BDF8' },
  submitted: { bg: '#38BDF820', fg: '#38BDF8' },
  winning: { bg: '#10B98120', fg: '#10B981' },
  lost: { bg: '#EF444420', fg: '#EF4444' },
  withdrawn: { bg: '#5E709020', fg: '#5E7090' },
  preparing: { bg: '#F59E0B20', fg: '#F59E0B' },
  in_transit: { bg: '#38BDF820', fg: '#38BDF8' },
  delivered: { bg: '#10B98120', fg: '#10B981' },
  open: { bg: '#F59E0B20', fg: '#F59E0B' },
  resolved: { bg: '#10B98120', fg: '#10B981' },
  overdue: { bg: '#EF444420', fg: '#EF4444' },
};

export function statusTagStyle(status: string) {
  return STATUS_TAG_COLOR[status] || { bg: '#5E709020', fg: '#5E7090' };
}
