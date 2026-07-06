/**
 * dampingvar.ts — bayi mağazası ürünleri, kategoriler ve sipariş akışı.
 * store_products / store_orders / store_order_items tablolarına bağlıdır.
 */
import { supabase } from './supabase';

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, icon, sort_order')
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
  category_name: string | null;
  has_video: boolean;
}

export async function getStoreProducts(storeId: string, categoryId?: string): Promise<StoreProduct[]> {
  let query = supabase
    .from('store_products')
    .select('id, name, price, image_url, unit, unit_size, stock_qty, category_id, has_video, categories(name)')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .gt('stock_qty', 0);
  if (categoryId) query = query.eq('category_id', categoryId);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    price: Number(r.price),
    image_url: r.image_url as string | null,
    unit: r.unit as string,
    unit_size: Number(r.unit_size),
    stock_qty: Number(r.stock_qty),
    category_id: r.category_id as string | null,
    category_name: (r.categories as { name?: string } | null)?.name ?? null,
    has_video: Boolean(r.has_video),
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
  unit_price: number;
  quantity: number;
}

export async function placeOrder(params: {
  storeId: string;
  customerId: string;
  items: CartLine[];
  paymentMethod: 'cash' | 'card_pos';
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

  const items = params.items.map((i) => ({
    order_id: order.id,
    store_product_id: i.store_product_id,
    product_name: i.product_name,
    unit_price: i.unit_price,
    quantity: i.quantity,
    total_price: i.unit_price * i.quantity,
  }));
  const { error: itemsError } = await supabase.from('store_order_items').insert(items);
  if (itemsError) throw itemsError;

  return order;
}

export async function getMyOrders(customerId: string) {
  const { data, error } = await supabase
    .from('store_orders')
    .select('id, total_amount, status, created_at, stores(name)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw error;
  return data ?? [];
}
