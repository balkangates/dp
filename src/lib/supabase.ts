import { createClient } from '@supabase/supabase-js';

// =====================================================
// SUPABASE
// =====================================================
const SUPABASE_URL = 'https://slajjrtfwncwlglhwhzg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsYWpqcnRmd25jd2xnbGh3aHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNzYzMTEsImV4cCI6MjA5NDY1MjMxMX0.krwWYXRQS7JhU9T5WRdsW2CRdefFJPSUCmJsLKAL0H8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'sb-slajjrtfwncwlglhwhzg-auth-token', // dashboard.html ile AYNI key
    autoRefreshToken: true,
    detectSessionInUrl: true, // index.html login sayfası — URL fragment'ı yakala
  },
  realtime: { params: { eventsPerSecond: 10 } }
});

// =====================================================
// PLATFORM AYARLARI
// =====================================================
export const PLATFORM_FEE = 10;          // %10 platform komisyonu
export const REPRESENTATIVE_FEE = 2;     // %2 temsilci komisyonu
export const AUTO_CONFIRM_DAYS = 7;      // Teslimat onayı bekleme günü
export const AUCTION_EXTEND_MINUTES = 5; // İhale uzatma süresi (dk)
export const AUCTION_DURATION_HOURS = 12; // İhale başlangıç süresi (saat)

// =====================================================
// AUTH HELPERS
// =====================================================
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signUp(email: string, password: string, fullName: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function resetPassword(email: string) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  return { data, error };
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return { data, error };
}

// =====================================================
// PLATFORM STATS — platform_stats tablosundan
// =====================================================
export async function getPlatformStats() {
  const { data, error } = await supabase
    .from('platform_stats')
    .select('*')
    .eq('id', 1)
    .single();
  return { data, error };
}

/** Realtime: platform_stats değişikliklerini dinle */
export function subscribeToPlatformStats(callback: (payload: Record<string, unknown>) => void) {
  return supabase
    .channel(`platform_stats_${Date.now()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'platform_stats' }, callback)
    .subscribe();
}

// =====================================================
// AKTİF İHALELER — auctions tablosundan
// =====================================================
export async function getActiveAuctions() {
  const { data, error } = await supabase
    .from('auctions')
    .select(`
      *,
      products (id, title, image_url, price, description, category, sector),
      profiles:seller_id (full_name, company_name, avatar_url)
    `)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(10);
  return { data, error };
}

/** Tek bir ihaleyi teklif geçmişiyle birlikte çek */
export async function getAuctionWithBids(auctionId: string) {
  const { data: auction, error: aErr } = await supabase
    .from('auctions')
    .select(`
      *,
      products (id, title, image_url, price, description, category, sector),
      profiles:seller_id (full_name, company_name, avatar_url)
    `)
    .eq('id', auctionId)
    .single();

  const { data: bids, error: bErr } = await supabase
    .from('auction_bids')
    .select('*, profiles:bidder_id (full_name, avatar_url)')
    .eq('auction_id', auctionId)
    .order('amount', { ascending: false })
    .limit(20);

  return { auction, bids, error: aErr || bErr };
}

/** Realtime: ihaleye gelen teklifleri ve auction güncellemelerini dinle */
export function subscribeToAuction(
  auctionId: string,
  onBid: (payload: Record<string, unknown>) => void,
  onAuctionUpdate: (payload: Record<string, unknown>) => void
) {
  return supabase
    .channel(`auction_${auctionId}_${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'auction_bids', filter: `auction_id=eq.${auctionId}` },
      onBid
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'auctions', filter: `id=eq.${auctionId}` },
      onAuctionUpdate
    )
    .subscribe();
}

// =====================================================
// TEKLİF VER — auction_bids tablosuna
// =====================================================
export async function placeBid(auctionId: string, bidderId: string, amount: number) {
  // 1) Teklifi kaydet
  const { data: bid, error: bidError } = await supabase
    .from('auction_bids')
    .insert({ auction_id: auctionId, bidder_id: bidderId, amount })
    .select()
    .single();

  if (bidError) return { data: null, error: bidError };

  // 2) auctions tablosunu güncelle (current_bid, bid_count, winner_id)
  const { error: auctionError } = await supabase
    .from('auctions')
    .update({
      current_bid: amount,
      bid_count: supabase.rpc('increment', { row_id: auctionId }),
      winner_id: bidderId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', auctionId)
    .lt('current_bid', amount); // sadece daha yüksek teklif geçerli

  return { data: bid, error: auctionError };
}

/** İhale süresini AUCTION_EXTEND_MINUTES kadar uzat (son dakika tekliflerinde) */
export async function extendAuction(auctionId: string, newEndTime: string) {
  const { error } = await supabase
    .from('auctions')
    .update({ end_time: newEndTime, extended_count: supabase.rpc('increment_extended', { aid: auctionId }) })
    .eq('id', auctionId);
  return { error };
}

// =====================================================
// ÜRÜNLER — products tablosundan
// =====================================================
export async function getProducts(saleType?: string, sector?: string) {
  let query = supabase
    .from('products')
    .select(`
      *,
      profiles:seller_id (full_name, company_name, avatar_url, rating)
    `)
    .eq('status', 'active');

  if (saleType && saleType !== 'all') {
    query = query.eq('sale_type', saleType);
  }
  if (sector && sector !== 'all') {
    query = query.eq('sector', sector);
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(12);
  return { data, error };
}

// =====================================================
// LİDERLİK TABLOSU — seller_stats tablosundan
// =====================================================
export async function getLeaderboard(limit = 10) {
  const { data, error } = await supabase
    .from('seller_stats')
    .select(`
      *,
      profiles:seller_id (full_name, company_name, avatar_url, rating)
    `)
    .order('total_revenue', { ascending: false })
    .limit(limit);
  return { data, error };
}

/** Realtime: seller_stats güncellemelerini dinle */
export function subscribeToLeaderboard(callback: (payload: Record<string, unknown>) => void) {
  return supabase
    .channel(`leaderboard_${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'seller_stats' }, callback)
    .subscribe();
}

// =====================================================
// SİPARİŞ OLUŞTUR — orders + order_items + payments + escrow_wallets
// =====================================================
export interface CartItemPayload {
  productId: string;
  sellerId: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
}

export async function createOrder(
  buyerId: string,
  items: CartItemPayload[],
  totalAmount: number
) {
  // Komisyon hesabı
  const platformCommission = Math.round(totalAmount * (PLATFORM_FEE / 100));
  const representativeCommission = Math.round(totalAmount * (REPRESENTATIVE_FEE / 100));
  const sellerNetAmount = totalAmount - platformCommission - representativeCommission;
  const taxAmount = Math.round(totalAmount * 0.2);
  const autoConfirmAt = new Date(Date.now() + AUTO_CONFIRM_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // İlk satıcıyı al (B2B: tek sipariş tek satıcı varsayımı)
  const sellerId = items[0]?.sellerId;
  const productId = items[0]?.productId;

  // Sipariş numarası oluştur
  const orderNumber = `DV-${Date.now().toString(36).toUpperCase()}`;

  // 1) orders kaydı
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      buyer_id: buyerId,
      seller_id: sellerId,
      product_id: productId,
      total_amount: totalAmount,
      tax_amount: taxAmount,
      platform_commission: platformCommission,
      representative_commission: representativeCommission,
      seller_net_amount: sellerNetAmount,
      order_status: 'PENDING_PAYMENT',
      payment_status: 'PENDING',
      escrow_status: 'PENDING',
      shipping_status: 'PENDING',
      auto_confirm_at: autoConfirmAt,
      order_number: orderNumber,
      sale_type: 'normal',
    })
    .select()
    .single();

  if (orderError || !order) return { data: null, error: orderError };

  // 2) order_items kayıtları
  const orderItems = items.map(item => ({
    order_id: order.id,
    product_id: item.productId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_price: item.unitPrice * item.quantity,
    tax_rate: item.taxRate ?? 20,
    tax_amount: Math.round(item.unitPrice * item.quantity * 0.2),
    total_with_tax: Math.round(item.unitPrice * item.quantity * 1.2),
  }));

  const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
  if (itemsError) return { data: null, error: itemsError };

  // 3) payments kaydı
  const { error: paymentError } = await supabase.from('payments').insert({
    order_id: order.id,
    buyer_id: buyerId,
    amount: totalAmount,
    total_amount: totalAmount,
    tax_amount: taxAmount,
    payment_method: 'BANK_TRANSFER',
    payment_status: 'PENDING',
    escrow_status: 'PENDING',
  });
  if (paymentError) return { data: null, error: paymentError };

  // 4) escrow_wallets kaydı
  const { error: escrowError } = await supabase.from('escrow_wallets').insert({
    order_id: order.id,
    buyer_id: buyerId,
    seller_id: sellerId,
    amount: totalAmount,
    status: 'pending',
  });
  if (escrowError) return { data: null, error: escrowError };

  // 5) commissions kaydı
  const { error: commissionError } = await supabase.from('commissions').insert({
    order_id: order.id,
    seller_id: sellerId,
    buyer_id: buyerId,
    gross_amount: totalAmount,
    platform_fee: platformCommission,
    influencer_fee: 0,
    seller_payout: sellerNetAmount,
    status: 'pending',
  });
  if (commissionError) return { data: null, error: commissionError };

  // 6) Bildirim gönder (alıcıya)
  await supabase.from('notifications').insert({
    user_id: buyerId,
    title: 'Siparişiniz Alındı',
    message: `${orderNumber} numaralı siparişiniz oluşturuldu. Ödeme bekleniyor.`,
    type: 'order',
  });

  return { data: order, error: null };
}

// =====================================================
// AKTİF KULLANICI GÜNCELLE
// =====================================================
export async function updateActiveUser(userId: string) {
  const { error } = await supabase
    .from('active_users')
    .upsert({ user_id: userId, last_active: new Date().toISOString(), is_active: true });
  return { error };
}
