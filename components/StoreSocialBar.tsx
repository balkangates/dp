'use client';
// components/StoreSocialBar.tsx — TikTok tarzı aksiyon çubuğu:
// Beğen / Yorum / Takip Et / Paylaş — mağaza (store) bazlı.
//
// Konumlandırma NOTU: masaüstünde (lg+) video/spotlight kutusunun sağ alt
// köşesine dikey overlay olarak biner (position: absolute — üst bileşen
// zaten `relative` bir sarmalayıcı). Mobilde (< lg) video 16:9 olduğu için
// kısa oluyor — 4 büyük ikonu dikey sığdırmak mümkün değil, bu yüzden
// mobilde OVERLAY DEĞİL, videonun ALTINDA normal akışta yatay bir şerit
// olarak render ediliyor (absolute'suz, in-flow). Bu yüzden "absolute" ve
// "flex-col" sınıfları SADECE lg: breakpoint'inde devrede.
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import {
  fetchStoreSocialStats, toggleStoreLike, toggleStoreFollow,
  fetchStoreComments, addStoreComment, deleteStoreComment, commentAuthorName, shareStore,
  type StoreSocialStats, type StoreComment,
} from '@/lib/store-social';

function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}B`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function ActionButton({
  icon, label, active, activeColor, onClick, busy,
}: {
  icon: string; label: string; active?: boolean; activeColor?: string; onClick: () => void; busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex flex-col items-center gap-1 disabled:opacity-50"
    >
      <motion.span
        whileTap={{ scale: 0.8 }}
        className="w-9 h-9 lg:w-11 lg:h-11 rounded-full flex items-center justify-center text-sm lg:text-lg backdrop-blur-sm"
        style={{
          background: active ? `${activeColor}25` : 'rgba(0,0,0,0.45)',
          border: `1px solid ${active ? activeColor : 'rgba(255,255,255,0.14)'}`,
          color: active ? activeColor : '#fff',
        }}
      >
        <i className={`fas ${icon}`} />
      </motion.span>
      <span className="text-[10px] font-bold text-white drop-shadow" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
        {label}
      </span>
    </button>
  );
}

export default function StoreSocialBar({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { user } = useAuth();
  const [stats, setStats] = useState<StoreSocialStats>({ likeCount: 0, isLiked: false, followerCount: 0, isFollowing: false, commentCount: 0 });
  const [likeBusy, setLikeBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [shareFlash, setShareFlash] = useState<string | null>(null);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<StoreComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetchStoreSocialStats(storeId, user?.id ?? null).then(setStats);
  }, [storeId, user?.id]);

  // ── Realtime: başka kullanıcıların beğeni/takip/yorum aksiyonları anlık
  // yansısın diye store_likes / store_follows / store_comments'i dinliyoruz.
  // Sadece kendi optimistic state'imizi değil, TÜM kullanıcıların
  // aksiyonlarını sayaca yansıtıyoruz (payload.new/old.user_id kendi
  // id'mize eşitse isLiked/isFollowing bayrağını da senkronladık — başka
  // bir sekmeden/aynı hesaptan yapılan değişiklik de yansısın diye).
  useEffect(() => {
    const channel = supabase
      .channel(`store_social_${storeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_likes', filter: `store_id=eq.${storeId}` },
        (payload) => setStats((s) => ({
          ...s,
          likeCount: s.likeCount + 1,
          isLiked: (payload.new as { user_id: string }).user_id === user?.id ? true : s.isLiked,
        })))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'store_likes', filter: `store_id=eq.${storeId}` },
        (payload) => setStats((s) => ({
          ...s,
          likeCount: Math.max(0, s.likeCount - 1),
          isLiked: (payload.old as { user_id: string }).user_id === user?.id ? false : s.isLiked,
        })))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_follows', filter: `store_id=eq.${storeId}` },
        (payload) => setStats((s) => ({
          ...s,
          followerCount: s.followerCount + 1,
          isFollowing: (payload.new as { user_id: string }).user_id === user?.id ? true : s.isFollowing,
        })))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'store_follows', filter: `store_id=eq.${storeId}` },
        (payload) => setStats((s) => ({
          ...s,
          followerCount: Math.max(0, s.followerCount - 1),
          isFollowing: (payload.old as { user_id: string }).user_id === user?.id ? false : s.isFollowing,
        })))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_comments', filter: `store_id=eq.${storeId}` },
        () => setStats((s) => ({ ...s, commentCount: s.commentCount + 1 })))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'store_comments', filter: `store_id=eq.${storeId}` },
        (payload) => {
          setStats((s) => ({ ...s, commentCount: Math.max(0, s.commentCount - 1) }));
          setComments((prev) => prev.filter((c) => c.id !== (payload.old as { id: string }).id));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId, user?.id]);

  // Yorum paneli açıkken yeni bir yorum eklenince (kendi eklemem de dahil,
  // başkasınınki de dahil) listeyi profil bilgisiyle birlikte tazele —
  // yukarıdaki realtime handler sadece sayaç/silme için ham veriyle
  // çalışıyor, profil join'i gerektiren INSERT'i burada ayrıca dinliyoruz.
  useEffect(() => {
    if (!showComments) return;
    const channel = supabase
      .channel(`store_comments_live_${storeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_comments', filter: `store_id=eq.${storeId}` },
        () => { fetchStoreComments(storeId).then(setComments); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [showComments, storeId]);

  const requireLogin = useCallback(() => {
    alert('Bu işlem için giriş yapmanız gerekiyor.');
  }, []);

  const handleLike = async () => {
    if (!user) return requireLogin();
    setLikeBusy(true);
    const prev = stats;
    setStats((s) => ({ ...s, isLiked: !s.isLiked, likeCount: s.likeCount + (s.isLiked ? -1 : 1) }));
    try {
      await toggleStoreLike(storeId);
    } catch (e) {
      setStats(prev);
      alert('İşlem başarısız: ' + (e as Error).message);
    } finally {
      setLikeBusy(false);
    }
  };

  const handleFollow = async () => {
    if (!user) return requireLogin();
    setFollowBusy(true);
    const prev = stats;
    setStats((s) => ({ ...s, isFollowing: !s.isFollowing, followerCount: s.followerCount + (s.isFollowing ? -1 : 1) }));
    try {
      await toggleStoreFollow(storeId);
    } catch (e) {
      setStats(prev);
      alert('İşlem başarısız: ' + (e as Error).message);
    } finally {
      setFollowBusy(false);
    }
  };

  const handleShare = async () => {
    try {
      const result = await shareStore(storeId, storeName);
      if (result === 'copied') {
        setShareFlash('Link kopyalandı');
        setTimeout(() => setShareFlash(null), 2000);
      }
    } catch {
      // kullanıcı native paylaşım panelini iptal etti — sessizce geç
    }
  };

  const openComments = async () => {
    setShowComments(true);
    if (commentsLoaded) return;
    setCommentsLoading(true);
    try {
      setComments(await fetchStoreComments(storeId));
      setCommentsLoaded(true);
    } finally {
      setCommentsLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!user) return requireLogin();
    const text = newComment.trim();
    if (!text) return;
    setPosting(true);
    try {
      await addStoreComment(storeId, user.id, text);
      setNewComment('');
      setComments(await fetchStoreComments(storeId));
    } catch (e) {
      alert('Yorum gönderilemedi: ' + (e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  const handleDeleteComment = async (id: string) => {
    if (!confirm('Yorumu silmek istediğinize emin misiniz?')) return;
    try {
      await deleteStoreComment(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      alert('Silinemedi: ' + (e as Error).message);
    }
  };

  return (
    <>
      {/* ── Aksiyon çubuğu ── videonun İÇİNDE sağ-alt köşede dikey overlay,
          TÜM ekran boyutlarında (TikTok tarzı) — StoreLiveViewer'daki video
          artık mobilde de (aspect-[4/5]) buna yer bırakacak kadar dikey. */}
      <div className="absolute right-2 lg:right-3 bottom-2 lg:bottom-3 z-30 flex flex-col gap-2.5 lg:gap-3.5">
        <ActionButton
          icon="fa-heart" label={compactCount(stats.likeCount)}
          active={stats.isLiked} activeColor="#EF4444" busy={likeBusy} onClick={handleLike}
        />
        <ActionButton
          icon="fa-comment-dots" label={compactCount(stats.commentCount)}
          onClick={openComments} activeColor="#38BDF8"
        />
        <ActionButton
          icon={stats.isFollowing ? 'fa-user-check' : 'fa-user-plus'} label={compactCount(stats.followerCount)}
          active={stats.isFollowing} activeColor="#D4AF37" busy={followBusy} onClick={handleFollow}
        />
        <ActionButton icon="fa-share" label="Paylaş" onClick={handleShare} activeColor="#10B981" />
      </div>

      {/* ── Paylaşım "kopyalandı" bildirimi ── */}
      <AnimatePresence>
        {shareFlash && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed left-1/2 -translate-x-1/2 bottom-24 lg:absolute lg:left-auto lg:translate-x-0 lg:right-3 lg:bottom-[220px] z-50 px-2.5 py-1 rounded-lg text-[10px] font-bold text-white"
            style={{ background: 'rgba(0,0,0,0.8)' }}
          >
            {shareFlash}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Yorumlar paneli ── `fixed`: video kutusunun (kısa/16:9) boyutuna
          bağlı DEĞİL, tüm ekranın altından açılan gerçek bir bottom-sheet —
          mobilde video kutusuna sıkışıp taşmasın diye. */}
      <AnimatePresence>
        {showComments && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setShowComments(false)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl flex flex-col mx-auto w-full lg:max-w-lg"
              style={{ background: '#0B1220', border: '1px solid #2A3650', maxHeight: '75vh' }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#2A3650' }}>
                <p className="text-white font-bold text-sm">Yorumlar ({stats.commentCount})</p>
                <button onClick={() => setShowComments(false)} className="text-[#5E7090] hover:text-white">
                  <i className="fas fa-xmark" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2.5">
                {commentsLoading ? (
                  <div className="text-center py-6 text-[#5E7090]"><i className="fas fa-spinner fa-spin" /></div>
                ) : comments.length === 0 ? (
                  <p className="text-[#5E7090] text-xs py-6 text-center">İlk yorumu sen yaz.</p>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-xs">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: '#D4AF3728', color: '#D4AF37' }}>
                        {commentAuthorName(c).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-white font-bold">{commentAuthorName(c)}</span>{' '}
                        <span className="text-[#A3B3D1] break-words">{c.comment}</span>
                        <div className="text-[9px] text-[#5E7090] font-mono mt-0.5 flex items-center gap-2">
                          {new Date(c.created_at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          {user?.id === c.user_id && (
                            <button onClick={() => handleDeleteComment(c.id)} className="text-[#5E7090] hover:text-red-400">Sil</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2 px-3 py-2.5 border-t" style={{ borderColor: '#2A3650' }}>
                <input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePostComment(); }}
                  placeholder={user ? 'Yorum yaz…' : 'Yorum yazmak için giriş yapın'}
                  maxLength={500}
                  disabled={!user || posting}
                  className="flex-1 rounded-xl px-3 py-2 text-white text-[12px] disabled:opacity-50"
                  style={{ background: '#131C2C', border: '1px solid #2A3650' }}
                />
                <button
                  onClick={handlePostComment}
                  disabled={!user || posting || !newComment.trim()}
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40"
                  style={{ background: '#D4AF37', color: '#000' }}
                >
                  <i className="fas fa-paper-plane text-xs" />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
