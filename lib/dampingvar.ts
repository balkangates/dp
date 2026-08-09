/**
 * dampingvar.ts — bayi mağazası ürünleri, kategoriler ve sipariş akışı.
 * store_products / store_orders / store_order_items tablolarına bağlıdır.
 */
import { supabase } from './supabase';

// ═══════════════════════════════════════════════════════════════════════
// FAZ D — SupplierPanel.tsx / FranchisePanel.tsx'in eksik olan importları.
// NOT: dashboard.html'de (public/modules/supplier.js, dealer-catalog.js)
// bu işlevlerin AYNI VERİ üzerinde çalışan gerçek bir karşılığı zaten var.
// Bu ekleme SADECE derleme hatalarını kapatıyor — bu iki React panelini
// App.tsx'e BAĞLAMIYOR (hâlâ orphan). İkisini de aktif etmek istersen ayrı
// bir karar/adım olmalı, aksi halde aynı işlev için iki ayrı arayüz
// (dashboard.html + React) birbirinden habersiz çalışır.
// ═══════════════════════════════════════════════════════════════════════

export interface ReverseAuction {
  id: string;
  product_name: string;
  total_quantity: number;
  quantity_unit: string;
  ceiling_price: number;
  end_time: string;
  status: string;
}

export interface SupplierBidRank {
  my_rank: number | null;
  total_bidders: number;
  lowest_price: number | null;
}

export async function getActiveReverseAuctions(): Promise<ReverseAuction[]> {
  const { data, error } = await supabase
    .from('reverse_auctions')
    .select('id, product_name, total_quantity, quantity_unit, ceiling_price, end_time, status')
    .eq('status', 'active')
    .order('end_time', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function submitBid(auctionId: string, supplierId: string, unitPrice: number): Promise<void> {
  const { error } = await supabase.from('supplier_bids').insert({
    auction_id: auctionId, supplier_id: supplierId, unit_price: unitPrice,
  });
  if (error) throw error;
}

// fn_my_bid_rank RPC'si (bkz. supabase_migration_v11_franchise_supplier_rpc.sql)
// rakiplerin TEKLİF DEĞERLERİNİ değil, sadece agregat sıralamayı döndürür —
// RLS'in yanında ek bir gizlilik katmanı.
export async function getMyBidRank(auctionId: string, supplierId: string): Promise<SupplierBidRank> {
  const { data, error } = await supabase.rpc('fn_my_bid_rank', {
    p_auction_id: auctionId, p_supplier_id: supplierId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    my_rank: row?.my_rank ?? null,
    total_bidders: row?.total_bidders ?? 0,
    lowest_price: row?.lowest_price ?? null,
  };
}

export async function getSupplierShipments(supplierId: string) {
  const { data, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function subscribeToAuctionBids(auctionId: string, callback: () => void) {
  const channel = supabase
    .channel(`auction-bids-${auctionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_bids', filter: `auction_id=eq.${auctionId}` }, callback)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export interface Store {
  id: string;
  name: string;
  is_live: boolean;
  city?: string | null;
  logo_url?: string | null;
}

export interface Demand {
  id: string;
  store_id: string;
  product_name: string;
  category?: string | null;
  quantity: number;
  quantity_unit: string;
  target_price: number;
  status: string;
  created_at: string;
}

export async function getMyStore(userId: string): Promise<Store | null> {
  const { data, error } = await supabase.from('stores').select('id, name, is_live, city, logo_url').eq('owner_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createDemand(params: {
  storeId: string; productName: string; category?: string; quantity: number; quantityUnit: string; targetPrice: number;
}): Promise<Demand> {
  const { data, error } = await supabase.from('demands').insert({
    store_id: params.storeId,
    product_name: params.productName,
    category: params.category ?? null,
    quantity: params.quantity,
    quantity_unit: params.quantityUnit,
    target_price: params.targetPrice,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function getStoreDemands(storeId: string): Promise<Demand[]> {
  const { data, error } = await supabase.from('demands').select('*').eq('store_id', storeId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getStoreOrders(storeId: string) {
  const { data, error } = await supabase.from('store_orders').select('*').eq('store_id', storeId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function setStoreLive(storeId: string, isLive: boolean): Promise<void> {
  const { error } = await supabase.from('stores').update({ is_live: isLive }).eq('id', storeId);
  if (error) throw error;
}

export interface OrderStatusEvent {
  id: string;
  order_id: string;
  status: string;
  previous_status?: string | null;
  changed_by?: string | null;
  note?: string | null;
  created_at: string;
  profiles?: { full_name?: string | null; role?: string | null } | null;
}

// İmza NOTU (FranchisePanel.tsx'teki "TASK 2.2 PATCH" yorumunda belirtildiği
// gibi): 3. parametre olarak changedBy eklendi — kim değiştirdi bilgisi
// order_status_events'e yazılıyor.
export async function updateOrderStatus(orderId: string, newStatus: string, changedBy: string, note?: string): Promise<void> {
  const { data: current, error: fetchErr } = await supabase.from('store_orders').select('status').eq('id', orderId).single();
  if (fetchErr) throw fetchErr;

  const { error } = await supabase.from('store_orders').update({ status: newStatus }).eq('id', orderId);
  if (error) throw error;

  await supabase.from('order_status_events').insert({
    order_id: orderId, source: 'store_orders', status: newStatus,
    previous_status: current?.status ?? null, changed_by: changedBy, note: note ?? null,
  });
}

export async function getOrderStatusHistory(orderId: string): Promise<OrderStatusEvent[]> {
  const { data, error } = await supabase
    .from('order_status_events')
    .select('*, profiles:changed_by(full_name, role)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OrderStatusEvent[];
}

export function subscribeToStoreOrders(storeId: string, callback: () => void) {
  const channel = supabase
    .channel(`store-orders-${storeId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders', filter: `store_id=eq.${storeId}` }, callback)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// ═══════════════════════════════════════════════════════════════════════
// FAZ B — CustomerHome.tsx: seçilen mağazanın CANLI toptan ihale süreci
// (azalan teklif). Salt okunur — customer teklif VEREMEZ, sadece görür.
// fn_store_active_auctions() SECURITY DEFINER RPC'si tekil supplier_bids
// satırlarını değil, agregat (kaç teklif / en düşük fiyat) döndürür — RLS
// bypass edilmiyor, sadece güvenli bir özet sunuluyor.
// ═══════════════════════════════════════════════════════════════════════
export interface StoreWholesaleAuction {
  reverse_auction_id: string;
  product_name: string;
  total_quantity: number;
  quantity_unit: string;
  ceiling_price: number;
  end_time: string;
  status: string;
  bid_count: number;
  lowest_price: number | null;
}

export async function getStoreActiveAuctions(storeId: string): Promise<StoreWholesaleAuction[]> {
  const { data, error } = await supabase.rpc('fn_store_active_auctions', { p_store_id: storeId });
  if (error) throw error;
  return data ?? [];
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
  sector_id: string | null;
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, icon, sort_order, sector_id')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface Subcategory {
  id: string;
  name: string;
  category_id: string;
}

export async function getSubcategories(): Promise<Subcategory[]> {
  const { data, error } = await supabase
    .from('subcategories')
    .select('id, name, category_id')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface Sector {
  id: string;
  label: string;
  icon: string | null;
  color: string | null;
}

// Mağaza ürünleri artık sadece kategori değil, ÖNCE SEKTÖR bazlı da
// filtrelenebiliyor (bkz. CustomerHome.tsx — sektör sekmesi → o sektöre
// ait kategori sekmeleri → ürün kartları). sectors tablosu → categories
// tablosu (sector_id FK) → store_products (category_id FK) zincirine bağlı.
export async function getSectors(): Promise<Sector[]> {
  const { data, error } = await supabase
    .from('sectors')
    .select('id, label, icon, color')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface StoreProduct {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  unit: string;
  unit_size: number;
  stock_qty: number;
  category_id: string | null;
  subcategory_id: string | null;
  category_name: string | null;
  has_video: boolean;
  flash_price: number | null;
  flash_price_ends_at: string | null;
  purchase_count: number;
}

export async function getStoreProducts(storeId: string, categoryId?: string, sectorId?: string, subcategoryId?: string): Promise<StoreProduct[]> {
  // Sadece sektör seçiliyken (kategori seçilmediyse) categories'i INNER
  // join'e çeviriyoruz ki "categories.sector_id" filtresi çalışsın.
  // Normalde (sektör/kategori seçili değilken) categories LEFT join
  // kalmalı — yoksa kategori atanmamış ürünler listeden kaybolur.
  const embed = (sectorId && !categoryId) ? 'categories!inner(name, sector_id)' : 'categories(name, sector_id)';
  let query = supabase
    .from('store_products')
    .select(`id, name, price, image_url, unit, unit_size, stock_qty, category_id, subcategory_id, has_video, flash_price, flash_price_ends_at, ${embed}`)
    .eq('store_id', storeId)
    .eq('is_active', true)
    .gt('stock_qty', 0);
  if (subcategoryId) query = query.eq('subcategory_id', subcategoryId);
  else if (categoryId) query = query.eq('category_id', categoryId);
  else if (sectorId) query = query.eq('categories.sector_id', sectorId);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;

  // v_store_product_purchase_counts bir VIEW olduğu için PostgREST FK
  // embed'i yapamıyor — GERÇEK satın alma sayılarını (uydurma değil)
  // ayrı bir sorguyla çekip ürün id'sine göre eşliyoruz.
  const ids = (data ?? []).map((r: Record<string, unknown>) => r.id as string);
  let countsById: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: counts } = await supabase
      .from('v_store_product_purchase_counts')
      .select('store_product_id, total_qty')
      .in('store_product_id', ids);
    countsById = Object.fromEntries((counts ?? []).map((c: Record<string, unknown>) => [c.store_product_id as string, Number(c.total_qty)]));
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    price: Number(r.price),
    image_url: r.image_url as string | null,
    unit: r.unit as string,
    unit_size: Number(r.unit_size),
    stock_qty: Number(r.stock_qty),
    category_id: r.category_id as string | null,
    subcategory_id: r.subcategory_id as string | null,
    category_name: (r.categories as { name?: string } | null)?.name ?? null,
    has_video: Boolean(r.has_video),
    flash_price: r.flash_price != null ? Number(r.flash_price) : null,
    flash_price_ends_at: r.flash_price_ends_at as string | null,
    purchase_count: countsById[r.id as string] ?? 0,
  }));
}

/** Bir mağaza ürününün "Detay" videosu (YouTube linki dahil) */
export async function getProductVideo(storeProductId: string): Promise<{ video_url: string; source: string } | null> {
  const { data, error } = await supabase
    .from('product_videos')
    .select('video_url, source')
    .eq('store_product_id', storeProductId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface CartLine {
  store_product_id: string;
  product_name: string;
  unit_price: number;      // KDV DAHİL birim fiyat (müşteriye gösterilen fiyat budur)
  quantity: number;
  discount_pct?: number;   // varsayılan 0 — ileride pazarlık/kampanya indirimi için
  tax_rate?: number;       // varsayılan 20 (%KDV)
}

export async function placeOrder(params: {
  storeId: string;
  customerId: string;
  items: CartLine[];
  paymentMethod: 'cash' | 'card_pos' | 'online_card' | 'bank_transfer';
  deliveryAddress: string;
  placedFromLive?: boolean;
}) {
  const total = params.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const { data: order, error: orderError } = await supabase
    .from('store_orders')
    .insert({
      store_id: params.storeId,
      customer_id: params.customerId,
      payment_method: params.paymentMethod,
      total_amount: total,
      delivery_address: params.deliveryAddress,
      placed_from_live: params.placedFromLive ?? false,
    })
    .select()
    .single();
  if (orderError) throw orderError;

  // unit_price KDV DAHİL kabul ediliyor (müşterinin gördüğü fiyat) —
  // net_price/tax_amount buradan geriye doğru hesaplanıyor. İndirim varsa
  // önce toplam tutardan düşülüyor, KDV o kalan tutar üzerinden ayrıştırılıyor.
  const items = params.items.map((i) => {
    const discountPct = i.discount_pct ?? 0;
    const taxRate = i.tax_rate ?? 20;
    const grossLine = i.unit_price * i.quantity;
    const afterDiscount = grossLine * (1 - discountPct / 100);
    const netPrice = round2(afterDiscount / (1 + taxRate / 100));
    const taxAmount = round2(afterDiscount - netPrice);
    return {
      order_id: order.id,
      store_product_id: i.store_product_id,
      product_name: i.product_name,
      unit_price: i.unit_price,
      quantity: i.quantity,
      total_price: grossLine,
      discount_pct: discountPct,
      tax_rate: taxRate,
      net_price: netPrice,
      tax_amount: taxAmount,
    };
  });
  const { error: itemsError } = await supabase.from('store_order_items').insert(items);
  if (itemsError) throw itemsError;

  return order;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PAYMENT_PENDING: 'Ödeme Bekliyor',
  CONFIRMED: 'Onaylandı',
  PREPARING: 'Hazırlanıyor',
  READY: 'Hazır',
  SHIPPED: 'Kargoda',
  DELIVERED: 'Teslim Edildi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
};

export async function getMyOrders(customerId: string) {
  const { data, error } = await supabase
    .from('store_orders')
    .select(`
      id, total_amount, status, created_at, payment_method, delivery_address, shipping_fee,
      stores(name),
      escrow_transactions(status), store_order_invoices(invoice_number),
      delivery_notes(document_no), store_order_shipments(carrier, tracking_number, status),
      store_order_items(product_name, quantity, unit_price, total_price)
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw error;
  return data ?? [];
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: '💵 Nakit',
  card_pos: '💳 Kapıda POS',
  online_card: '🔒 Online Kart',
  bank_transfer: '🏦 Havale',
};

// ── FAZ 6: canlı satış — yayıncı kontrolü (flash fiyat + öne çıkan ürün) ──
// Backend: fixes/fix_phase6_live_commerce_triggers.sql
export async function setFlashPrice(storeProductId: string, price: number, minutes: number) {
  const { error } = await supabase.rpc('set_flash_price', {
    p_store_product_id: storeProductId,
    p_price: price,
    p_minutes: minutes,
  });
  if (error) throw error;
}

export async function clearFlashPrice(storeProductId: string) {
  const { error } = await supabase.rpc('clear_flash_price', { p_store_product_id: storeProductId });
  if (error) throw error;
}

export async function setSpotlightProduct(storeId: string, storeProductId: string | null) {
  const { error } = await supabase.rpc('set_spotlight_product', {
    p_store_id: storeId,
    p_store_product_id: storeProductId,
  });
  if (error) throw error;
}
