/**
 * geo.ts — konum tespiti ve en yakın bayi mağazası hesaplama.
 * Müşteri sipariş verebilmek için ÖNCE bir mağaza seçmek zorunda (bkz. CustomerHome.tsx).
 */
import { supabase } from './supabase';

export interface NearbyStore {
  store_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  is_live: boolean;
  distance_km: number;
}

export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Tarayıcınız konum servisini desteklemiyor.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('Konum izni verilmedi. Mağazayı listeden manuel seçebilirsiniz.')),
      { timeout: 8000 },
    );
  });
}

// Haversine formülü — iki koordinat arası km cinsinden mesafe
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getNearestStores(lat: number, lng: number, limit = 20): Promise<NearbyStore[]> {
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, address, lat, lng, is_live')
    .eq('status', 'active')
    .not('lat', 'is', null)
    .not('lng', 'is', null);
  if (error) throw error;

  return (data ?? [])
    .map((s) => ({
      store_id: s.id,
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      is_live: s.is_live,
      distance_km: haversineKm(lat, lng, s.lat, s.lng),
    }))
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit);
}

export interface StoreListing {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  is_live: boolean;
}

/** Konum izni yoksa ya da konumsuz kalınca: tüm aktif mağazaları listele */
export async function getAllStores(limit = 20): Promise<StoreListing[]> {
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, address, lat, lng, is_live')
    .eq('status', 'active')
    .order('is_live', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Next.js'te müşteri doğrudan /store/[storeId] URL'sine gelebilir (paylaşılan
// link, bookmark, vb.) — bu durumda StoreSelector'dan geçmeden tek mağazayı
// id'sinden çekmek gerekiyor.
export async function getStoreById(storeId: string): Promise<NearbyStore | null> {
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, address, lat, lng, is_live')
    .eq('id', storeId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    store_id: data.id,
    name: data.name,
    address: data.address,
    lat: data.lat ?? 0,
    lng: data.lng ?? 0,
    is_live: data.is_live,
    distance_km: NaN,
  };
}
