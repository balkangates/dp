// lib/dealer-catalog.ts — modules/dealer-catalog.js'in veri katmanının
// Next.js/React tarafına taşınmış hâli.
import { supabase } from './supabase';
import { getYoutubeEmbedUrl } from './youtube';

export interface Category {
  id: string;
  name: string;
  sector_id: string | null;
}

export interface CatalogProduct {
  id: string;
  category_id: string;
  subcategory_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  unit: string;
  unit_size: number;
  suggested_price: number | null;
  is_approved: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StoreProductRow = any;

export async function loadCategories(): Promise<Category[]> {
  const { data } = await supabase.from('categories').select('id,name,sector_id').eq('is_active', true).order('name');
  return data || [];
}

export async function loadApprovedCatalog(): Promise<CatalogProduct[]> {
  const { data } = await supabase.from('catalog_products').select('*').eq('is_approved', true).order('name');
  return data || [];
}

export async function loadMyStoreProducts(storeId: string): Promise<StoreProductRow[]> {
  const { data } = await supabase
    .from('store_products')
    .select('*, product_videos(id, video_url, created_at)')
    .eq('store_id', storeId);
  return data || [];
}

export async function loadCategoryStatus(storeId: string) {
  const { data } = await supabase.from('store_category_status').select('*').eq('store_id', storeId);
  return data || [];
}

export async function selectCatalogProduct(storeId: string, catalogProduct: CatalogProduct) {
  const { error } = await supabase.from('store_products').insert({
    store_id: storeId,
    catalog_product_id: catalogProduct.id,
    category_id: catalogProduct.category_id,
    subcategory_id: catalogProduct.subcategory_id,
    name: catalogProduct.name,
    description: catalogProduct.description,
    image_url: catalogProduct.image_url,
    unit: catalogProduct.unit,
    unit_size: catalogProduct.unit_size,
    price: catalogProduct.suggested_price || 0,
    is_active: false, // video yüklenene kadar pasif kalır — DB de zaten zorunlu kılıyor
  });
  if (error) throw error;
}

export async function deselectStoreProduct(storeProductId: string) {
  const { error } = await supabase.from('store_products').delete().eq('id', storeProductId);
  if (error) throw error;
}

export async function updateStock(storeProductId: string, qty: number) {
  const { error } = await supabase.from('store_products').update({ stock_qty: qty }).eq('id', storeProductId);
  if (error) throw error;
}

export async function addYoutubeLink(storeProductId: string, rawUrl: string) {
  const url = rawUrl.trim();
  if (!getYoutubeEmbedUrl(url)) {
    throw new Error('Geçerli bir YouTube video linki girin. Örnek: https://www.youtube.com/watch?v=XXXXXXXXXXX');
  }
  const { error: insErr } = await supabase.from('product_videos').insert({
    store_product_id: storeProductId,
    video_url: url,
    source: 'youtube',
  });
  if (insErr) throw insErr;
  // Video linki var artık — ürünü aktive et (DB tetikleyicisi has_video=true görüp izin verir).
  await supabase.from('store_products').update({ is_active: true }).eq('id', storeProductId);
}

export async function removeVideo(videoId: string) {
  const { error } = await supabase.from('product_videos').delete().eq('id', videoId);
  if (error) throw error;
}
