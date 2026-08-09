// lib/store-social.ts — mağaza (store) bazlı sosyal özellikler: beğeni,
// takip, yorum. Paylaş DB'de bir şey tutmuyor (bkz. shareStore) — TikTok'taki
// gibi link paylaşımı, sayaç tutmuyoruz (kapsam dışı bırakıldı).
//
// Beğeni/takip toggle'ları atomik RPC'lerle yapılıyor (toggle_store_like,
// toggle_store_follow — bkz. fixes/fix_store_social.sql) — check-sonra-insert
// yerine tek round-trip, race condition'a kapalı.
import { supabase } from './supabase';

export interface StoreSocialStats {
  likeCount: number;
  isLiked: boolean;
  followerCount: number;
  isFollowing: boolean;
  commentCount: number;
}

export interface StoreComment {
  id: string;
  store_id: string;
  user_id: string;
  comment: string;
  created_at: string;
  profiles: { full_name: string | null; company_name: string | null; rumuz: string | null } | null;
}

export async function fetchStoreSocialStats(storeId: string, userId: string | null): Promise<StoreSocialStats> {
  const [{ count: likeCount }, { count: followerCount }, { count: commentCount }, likedRes, followingRes] = await Promise.all([
    supabase.from('store_likes').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('store_follows').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    supabase.from('store_comments').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
    userId
      ? supabase.from('store_likes').select('id').eq('store_id', storeId).eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase.from('store_follows').select('id').eq('store_id', storeId).eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    likeCount: likeCount ?? 0,
    isLiked: !!(likedRes as { data: unknown }).data,
    followerCount: followerCount ?? 0,
    isFollowing: !!(followingRes as { data: unknown }).data,
    commentCount: commentCount ?? 0,
  };
}

// Dönüş: işlemden sonraki durum (true = artık beğenildi/takip ediliyor).
export async function toggleStoreLike(storeId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_store_like', { p_store_id: storeId });
  if (error) throw error;
  return data as boolean;
}

export async function toggleStoreFollow(storeId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_store_follow', { p_store_id: storeId });
  if (error) throw error;
  return data as boolean;
}

export async function fetchStoreComments(storeId: string): Promise<StoreComment[]> {
  const { data, error } = await supabase
    .from('store_comments')
    .select('*, profiles:user_id(full_name, company_name, rumuz)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as unknown as StoreComment[]) || [];
}

export async function addStoreComment(storeId: string, userId: string, comment: string) {
  const trimmed = comment.trim();
  if (!trimmed) throw new Error('Yorum boş olamaz.');
  const { error } = await supabase.from('store_comments').insert({ store_id: storeId, user_id: userId, comment: trimmed });
  if (error) throw error;
}

export async function deleteStoreComment(commentId: string) {
  const { error } = await supabase.from('store_comments').delete().eq('id', commentId);
  if (error) throw error;
}

export function commentAuthorName(c: StoreComment): string {
  return c.profiles?.rumuz ?? c.profiles?.full_name ?? c.profiles?.company_name ?? 'Kullanıcı';
}

// Web Share API varsa onu kullan (mobilde native paylaşım sayfası açar),
// yoksa linki panoya kopyala. DB'de bir kayıt/sayaç tutulmuyor.
export async function shareStore(storeId: string, storeName: string): Promise<'shared' | 'copied'> {
  const url = `${window.location.origin}/store/${storeId}`;
  if (navigator.share) {
    await navigator.share({ title: storeName, url });
    return 'shared';
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
