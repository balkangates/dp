'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, Track } from 'livekit-client';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import {
  ensureStore, createStore, loadDealerProducts, loadRecentOrders,
  NEXT_STATUS, STATUS_LABEL, advanceOrder, cancelOrder, toggleLiveSession,
  explainBlockReason, fetchPublisherToken, type Store,
} from '@/lib/dealer';
import { setFlashPrice, clearFlashPrice, setSpotlightProduct } from '@/lib/dampingvar';
import { acceptCall, rejectCall, getStoreOffers, respondToOffer, type CallRequest } from '@/lib/negotiation';
import { markOrderShipped, CARRIERS } from '@/lib/logistics';
import VideoCallModal from '@/components/VideoCallModal';
import LiveStream from '@/components/LiveStream';
import { fetchStoreSocialStats, type StoreSocialStats } from '@/lib/store-social';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export default function DealerLivePage() {
  const { profile } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [newStoreName, setNewStoreName] = useState('');
  const [products, setProducts] = useState<AnyRow[]>([]);
  const [orders, setOrders] = useState<AnyRow[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [incomingCalls, setIncomingCalls] = useState<CallRequest[]>([]);
  const [activeCall, setActiveCall] = useState<CallRequest | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [offers, setOffers] = useState<any[]>([]);
  const [counterInputFor, setCounterInputFor] = useState<string | null>(null);
  const [counterValue, setCounterValue] = useState('');
  const [shipFormFor, setShipFormFor] = useState<string | null>(null);
  const [shipCarrier, setShipCarrier] = useState<string>('yurtici');
  const [shipTracking, setShipTracking] = useState('');
  const [flashFormFor, setFlashFormFor] = useState<string | null>(null);
  const [flashPriceInput, setFlashPriceInput] = useState('');
  const [flashMinutes, setFlashMinutes] = useState('15');
  const [spotlightBusy, setSpotlightBusy] = useState(false);
  // Bayinin kendi mağazasının beğeni/takipçi sayıları — salt okunur
  // farkındalık amaçlı (bayi kendi mağazasını beğenip takip edemez, o
  // yüzden StoreSocialBar burada değil, sadece sayaçlar gösteriliyor).
  const [socialStats, setSocialStats] = useState<StoreSocialStats | null>(null);

  const roomRef = useRef<Room | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const refresh = useCallback(async (s: Store) => {
    const [p, o] = await Promise.all([loadDealerProducts(s.id), loadRecentOrders(s.id)]);
    setProducts(p);
    setOrders(o);
    const { data } = await supabase.from('stores').select('*').eq('id', s.id).single();
    setStore(data);
  }, []);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const s = await ensureStore(profile.id);
      setStore(s);
      if (s) await refresh(s);
      setLoading(false);
    })();
  }, [profile, refresh]);

  useEffect(() => {
    if (!store) return;
    fetchStoreSocialStats(store.id, null).then(setSocialStats);
  }, [store]);

  // Realtime — yeni sipariş geldiğinde otomatik yenile
  useEffect(() => {
    if (!store) return;
    const channel = supabase
      .channel(`store-orders-${store.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_orders', filter: `store_id=eq.${store.id}` },
        () => refresh(store))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [store, refresh]);

  // Realtime — gelen görüntülü görüşme istekleri
  useEffect(() => {
    if (!store) return;
    const channel = supabase
      .channel(`store-calls-${store.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_requests', filter: `store_id=eq.${store.id}` },
        (payload) => setIncomingCalls((prev) => [...prev, payload.new as CallRequest]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_requests', filter: `store_id=eq.${store.id}` },
        (payload) => {
          const row = payload.new as CallRequest;
          setIncomingCalls((prev) => prev.filter((c) => c.id !== row.id));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [store]);

  // Teklifleri yükle + realtime tazele
  const refreshOffers = useCallback(async () => {
    if (!store) return;
    setOffers(await getStoreOffers(store.id));
  }, [store]);

  useEffect(() => { refreshOffers(); }, [refreshOffers]);

  useEffect(() => {
    if (!store) return;
    const channel = supabase
      .channel(`store-offers-${store.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'negotiation_offers' }, () => refreshOffers())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [store, refreshOffers]);

  const handleAcceptCall = async (call: CallRequest) => {
    try {
      await acceptCall(call.id);
      setIncomingCalls((prev) => prev.filter((c) => c.id !== call.id));
      setActiveCall({ ...call, status: 'accepted' });
    } catch (e) {
      alert('Kabul edilemedi: ' + (e as Error).message);
    }
  };

  const handleRejectCall = async (call: CallRequest) => {
    try {
      await rejectCall(call.id);
      setIncomingCalls((prev) => prev.filter((c) => c.id !== call.id));
    } catch (e) {
      alert('İşlem başarısız: ' + (e as Error).message);
    }
  };

  const handleRespondOffer = async (offerId: string, action: 'accepted' | 'rejected') => {
    try {
      await respondToOffer(offerId, action);
      refreshOffers();
    } catch (e) {
      alert('İşlem başarısız: ' + (e as Error).message);
    }
  };

  const handleCounter = async (offerId: string) => {
    const price = Number(counterValue);
    if (!price || price <= 0) { alert('Geçerli bir fiyat girin.'); return; }
    try {
      await respondToOffer(offerId, 'countered', price);
      setCounterInputFor(null);
      setCounterValue('');
      refreshOffers();
    } catch (e) {
      alert('İşlem başarısız: ' + (e as Error).message);
    }
  };

  const handleCreateStore = async () => {
    if (!profile || !newStoreName.trim()) return;
    const s = await createStore(profile.id, newStoreName.trim());
    setStore(s);
    await refresh(s);
  };

  const connectPublisher = async (storeId: string) => {
    const { token, ws_url } = await fetchPublisherToken(storeId);
    const room = new Room();
    roomRef.current = room;
    await room.connect(ws_url, token);

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    streamRef.current = stream;
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    if (videoTrack) await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.Camera });
    if (audioTrack) await room.localParticipant.publishTrack(audioTrack, { source: Track.Source.Microphone });
    if (videoElRef.current) {
      videoElRef.current.srcObject = stream;
      videoElRef.current.play().catch(() => {});
    }
  };

  const disconnectPublisher = () => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => () => disconnectPublisher(), []);

  const handleToggleLive = async () => {
    if (!store) return;
    setConnecting(true);
    try {
      if (store.is_live) {
        disconnectPublisher();
        await toggleLiveSession(store.id, true);
      } else {
        await toggleLiveSession(store.id, false);
        try {
          await connectPublisher(store.id);
        } catch (videoErr) {
          alert('Canlı oturumu başladı ama kamera/video bağlantısı kurulamadı: ' + (videoErr as Error).message
            + '\n(Müşteriler yine mağazanızı canlı görür, sipariş akışı normal çalışır — sadece görüntü gitmez.)');
        }
      }
    } catch (e) {
      alert(explainBlockReason((e as Error)?.message || ''));
      setConnecting(false);
      return;
    }
    await refresh(store);
    setConnecting(false);
  };

  const handleAdvance = async (orderId: string, next: string) => {
    if (next === 'SHIPPED') {
      setShipFormFor(orderId);
      return;
    }
    try {
      await advanceOrder(orderId, next);
      if (store) await refresh(store);
    } catch (e) {
      alert('Durum güncellenemedi: ' + (e as Error).message);
    }
  };

  const handleConfirmShip = async (orderId: string) => {
    if (!shipTracking.trim() && shipCarrier !== 'manual') {
      alert('Takip numarası girin (kendi aracınızla teslim ediyorsanız "Kendi Aracımız" seçip boş bırakabilirsiniz).');
      return;
    }
    try {
      await markOrderShipped(orderId, shipCarrier, shipTracking.trim());
      setShipFormFor(null);
      setShipTracking('');
      if (store) await refresh(store);
    } catch (e) {
      alert('Kargoya verilemedi: ' + (e as Error).message);
    }
  };

  const handleSetFlashPrice = async (productId: string) => {
    const price = Number(flashPriceInput);
    const minutes = Number(flashMinutes);
    if (!price || price <= 0) { alert('Geçerli bir flash fiyat girin.'); return; }
    if (!minutes || minutes <= 0) { alert('Geçerli bir süre (dakika) girin.'); return; }
    try {
      await setFlashPrice(productId, price, minutes);
      setFlashFormFor(null);
      setFlashPriceInput('');
      if (store) await refresh(store);
    } catch (e) {
      alert('Flash fiyat ayarlanamadı: ' + (e as Error).message);
    }
  };

  const handleClearFlashPrice = async (productId: string) => {
    try {
      await clearFlashPrice(productId);
      if (store) await refresh(store);
    } catch (e) {
      alert('Kaldırılamadı: ' + (e as Error).message);
    }
  };

  const handleToggleSpotlight = async (productId: string) => {
    if (!store) return;
    setSpotlightBusy(true);
    try {
      const next = store.spotlight_product_id === productId ? null : productId;
      await setSpotlightProduct(store.id, next);
      setStore((prev) => (prev ? { ...prev, spotlight_product_id: next } : prev));
    } catch (e) {
      alert('Öne çıkarılamadı: ' + (e as Error).message);
    } finally {
      setSpotlightBusy(false);
    }
  };

  const handleCancel = async (orderId: string) => {
    if (!confirm('Bu siparişi iptal etmek istediğinize emin misiniz?')) return;
    try {
      await cancelOrder(orderId);
      if (store) await refresh(store);
    } catch (e) {
      alert('İptal edilemedi: ' + (e as Error).message);
    }
  };

  if (loading) return <p className="text-[#5E7090] font-mono text-sm">Yükleniyor…</p>;

  if (!store) {
    return (
      <div className="max-w-sm space-y-3">
        <p className="text-white font-bold">Henüz bir mağazanız yok</p>
        <input
          placeholder="Mağaza adı"
          value={newStoreName}
          onChange={(e) => setNewStoreName(e.target.value)}
          className="w-full bg-black/30 border border-[#2A3650] rounded-lg px-3 py-2 text-sm text-white"
        />
        <button
          onClick={handleCreateStore}
          className="rounded-lg px-4 py-2 text-xs font-extrabold"
          style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000' }}
        >
          Mağaza Oluştur
        </button>
      </div>
    );
  }

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? products[0];

  return (
    <div className="space-y-4">
      {incomingCalls.map((call) => (
        <div key={call.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: '#D4AF3720', border: '1px solid #D4AF37' }}>
          <p className="text-white text-sm font-bold">
            <i className="fas fa-phone-volume mr-2 animate-pulse" style={{ color: '#D4AF37' }} />
            Bir müşteri görüntülü görüşmek istiyor
          </p>
          <div className="flex gap-2">
            <button onClick={() => handleAcceptCall(call)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: '#10B981', color: '#fff' }}>Kabul Et</button>
            <button onClick={() => handleRejectCall(call)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: '#2A3650', color: '#A3B3D1' }}>Reddet</button>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-black text-lg">
            <i className="fas fa-video mr-2" style={{ color: store.is_live ? '#EF4444' : '#D4AF37' }} />
            Canlı Satış — {store.name}
          </p>
          {socialStats && (
            <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-[#5E7090]">
              <span><i className="fas fa-heart mr-1" style={{ color: '#EF4444' }} />{socialStats.likeCount} beğeni</span>
              <span><i className="fas fa-user-check mr-1" style={{ color: '#D4AF37' }} />{socialStats.followerCount} takipçi</span>
            </div>
          )}
        </div>
        <button
          onClick={handleToggleLive}
          disabled={connecting}
          className="rounded-lg px-4 py-2 text-xs font-extrabold flex items-center gap-2"
          style={{ background: store.is_live ? '#EF4444' : '#10B981', color: '#fff', opacity: connecting ? 0.6 : 1 }}
        >
          <i className={`fas ${store.is_live ? 'fa-stop' : 'fa-play'}`} />
          {store.is_live ? 'Canlıyı Bitir' : 'Canlıya Geç'}
        </button>
      </div>

      {store.is_live && (
        <div className="rounded-2xl p-3" style={CARD}>
          <video ref={videoElRef} muted autoPlay playsInline className="w-full max-h-72 rounded-lg bg-black object-cover" />
          <p className="text-[10px] text-[#5E7090] mt-1.5">
            <i className="fas fa-broadcast-tower mr-1" /> Bu, izleyicilerin gördüğü canlı yayının kendi önizlemenizdir.
          </p>
        </div>
      )}

      {/* Müşteri sohbeti — app/store/[storeId]/page.tsx'teki ile AYNI bileşen,
          aynı storeId ile aynı conversation'a bağlanıyor (bkz.
          get_or_create_store_live_conversation RPC). Önceden bu bileşen
          sadece müşteri tarafında render ediliyordu; bayi panelinde hiç
          yoktu — mesajlar DB'ye doğru yazılıyordu ama bayi ekranında
          gösterecek bir widget bulunmuyordu. is_live'a bağlı DEĞİL: müşteri
          mağaza sayfasını her zaman görebildiği için (canlı olsun olmasın)
          bayi de sohbeti her zaman görüp yanıtlayabilmeli. */}
      <LiveStream storeId={store.id} storeName={store.name} isOwnerView />

      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-4">
        <div className="rounded-2xl p-4" style={CARD}>
          <p className="text-white font-bold text-sm mb-2">Ürünleriniz ({products.length})</p>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {products.map((p) => {
              const isSpotlight = store.spotlight_product_id === p.id;
              const flashActive = Boolean(p.flash_price && p.flash_price_ends_at && new Date(p.flash_price_ends_at) > new Date());
              return (
                <div
                  key={p.id}
                  className="rounded-lg px-3 py-2 text-xs"
                  style={{ background: selectedProduct?.id === p.id ? '#D4AF3720' : '#0B1220', border: `1px solid ${isSpotlight ? '#D4AF37' : '#1E2A42'}` }}
                >
                  <button onClick={() => setSelectedProductId(p.id)} className="w-full text-left flex items-center justify-between">
                    <span className="text-white">{p.name}</span>
                    <span className="text-[#5E7090] font-mono">Stok: {p.stock_qty}</span>
                  </button>

                  {flashActive && (
                    <p className="text-[10px] mt-1" style={{ color: '#10B981' }}>
                      <i className="fas fa-bolt mr-1" />Flash: ₺{p.flash_price} — {new Date(p.flash_price_ends_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}&apos;e kadar
                    </p>
                  )}

                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <button
                      onClick={() => handleToggleSpotlight(p.id)}
                      disabled={spotlightBusy}
                      className="px-2 py-1 rounded text-[10px] font-bold"
                      style={isSpotlight ? { background: '#D4AF37', color: '#000' } : { border: '1px solid #2A3650', color: '#5E7090' }}
                    >
                      <i className="fas fa-bullhorn mr-1" />{isSpotlight ? 'Öne Çıkarılıyor' : 'Öne Çıkar'}
                    </button>
                    {flashActive ? (
                      <button onClick={() => handleClearFlashPrice(p.id)} className="px-2 py-1 rounded text-[10px] font-bold" style={{ border: '1px solid #EF4444', color: '#EF4444' }}>
                        Flash İndirimi Kaldır
                      </button>
                    ) : (
                      <button
                        onClick={() => { setFlashFormFor(flashFormFor === p.id ? null : p.id); setFlashPriceInput(''); }}
                        className="px-2 py-1 rounded text-[10px] font-bold"
                        style={{ border: '1px solid #2A3650', color: '#5E7090' }}
                      >
                        <i className="fas fa-bolt mr-1" />Flash İndirim
                      </button>
                    )}
                  </div>

                  {flashFormFor === p.id && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <input
                        type="number" placeholder={`Fiyat (liste: ₺${p.price})`} value={flashPriceInput}
                        onChange={(e) => setFlashPriceInput(e.target.value)}
                        className="flex-1 bg-black/30 border border-[#2A3650] rounded px-2 py-1 text-white text-[10px]"
                      />
                      <select
                        value={flashMinutes}
                        onChange={(e) => setFlashMinutes(e.target.value)}
                        className="bg-black/30 border border-[#2A3650] rounded px-1 py-1 text-white text-[10px]"
                      >
                        <option value="5">5 dk</option>
                        <option value="15">15 dk</option>
                        <option value="30">30 dk</option>
                        <option value="60">60 dk</option>
                      </select>
                      <button onClick={() => handleSetFlashPrice(p.id)} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#D4AF37', color: '#000' }}>Başlat</button>
                    </div>
                  )}
                </div>
              );
            })}
            {products.length === 0 && <p className="text-[#5E7090] text-xs font-mono">Henüz ürün seçmediniz — Ürün Seçimi sayfasına gidin.</p>}
          </div>
        </div>

        <div className="rounded-2xl p-4" style={CARD}>
          <p className="text-white font-bold text-sm mb-2">Gerçek Zamanlı Sipariş Akışı</p>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {orders.length === 0 && <p className="text-[#5E7090] text-xs font-mono">Henüz sipariş yok.</p>}
            {orders.map((o) => {
              const itemsSummary = (o.store_order_items || []).map((i: AnyRow) => `${i.quantity}× ${i.product_name}`).join(', ');
              const next = NEXT_STATUS[o.status];
              const escrow = o.escrow_transactions?.[0];
              const invoice = o.store_order_invoices?.[0];
              const deliveryNote = o.delivery_notes?.[0];
              const cancellable = !['COMPLETED', 'CANCELLED', 'DELIVERED'].includes(o.status);
              return (
                <div key={o.id} className="rounded-lg p-2.5 text-xs" style={{ background: '#0B1220', border: '1px solid #1E2A42' }}>
                  <div className="flex justify-between items-center flex-wrap gap-1.5">
                    <span className="text-white font-bold">{itemsSummary || 'Sipariş'}</span>
                    <span className="text-[#10B981] font-mono">₺{Number(o.total_amount).toLocaleString('tr-TR')}</span>
                  </div>
                  <div className="flex justify-between items-center mt-1.5 flex-wrap gap-1.5">
                    <span className="text-[10px] text-[#5E7090] font-mono">{new Date(o.created_at).toLocaleString('tr-TR')}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: '#1E2A42' }}>{STATUS_LABEL[o.status] || o.status}</span>
                      {cancellable && (
                        <button onClick={() => handleCancel(o.id)} className="text-[#5E7090] hover:text-red-400" title="İptal et">
                          <i className="fas fa-ban" />
                        </button>
                      )}
                      {next && (
                        <button
                          onClick={() => handleAdvance(o.id, next)}
                          className="px-2 py-1 rounded text-[10px] font-bold"
                          style={{ background: '#D4AF37', color: '#000' }}
                        >
                          {STATUS_LABEL[next]} <i className="fas fa-arrow-right ml-0.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {shipFormFor === o.id && (
                    <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-dashed border-[#1E2A42]">
                      <select
                        value={shipCarrier}
                        onChange={(e) => setShipCarrier(e.target.value)}
                        className="bg-black/30 border border-[#2A3650] rounded px-2 py-1 text-white text-[10px]"
                      >
                        {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      <input
                        placeholder="Takip no" value={shipTracking}
                        onChange={(e) => setShipTracking(e.target.value)}
                        className="flex-1 bg-black/30 border border-[#2A3650] rounded px-2 py-1 text-white text-[10px]"
                      />
                      <button onClick={() => handleConfirmShip(o.id)} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#D4AF37', color: '#000' }}>Onayla</button>
                      <button onClick={() => setShipFormFor(null)} className="px-2 py-1 rounded text-[10px]" style={{ background: '#2A3650', color: '#A3B3D1' }}>Vazgeç</button>
                    </div>
                  )}
                  {(escrow || invoice || deliveryNote) && (
                    <div className="flex gap-2.5 flex-wrap mt-1.5 pt-1.5 border-t border-dashed border-[#1E2A42] text-[10px] text-[#5E7090]">
                      {escrow && (
                        <span>
                          <i className="fas fa-vault mr-1" style={{ color: escrow.status === 'HELD' ? '#F59E0B' : escrow.status === 'RELEASED' ? '#10B981' : '#EF4444' }} />
                          Escrow: {escrow.status === 'HELD' ? 'Bekliyor' : escrow.status === 'RELEASED' ? 'Serbest' : 'İade'} (₺{Number(escrow.net_amount).toLocaleString('tr-TR')} size)
                        </span>
                      )}
                      {invoice && <span><i className="fas fa-file-invoice mr-1" />Fatura: {invoice.invoice_number}</span>}
                      {deliveryNote && <span><i className="fas fa-truck mr-1" />İrsaliye: {deliveryNote.document_no}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {offers.length > 0 && (
        <div className="rounded-2xl p-4" style={CARD}>
          <p className="text-white font-bold text-sm mb-2">Gelen Fiyat Teklifleri</p>
          <div className="space-y-2">
            {offers.map((o) => (
              <div key={o.id} className="rounded-lg p-2.5 text-xs" style={{ background: '#0B1220', border: '1px solid #1E2A42' }}>
                <div className="flex justify-between">
                  <span className="text-white font-bold">{o.store_products?.name} × {o.quantity}</span>
                  <span className="text-[#5E7090]">{o.profiles?.company_name || o.profiles?.full_name || 'Müşteri'}</span>
                </div>
                <div className="flex justify-between mt-1 font-mono text-[#A3B3D1]">
                  <span>Liste fiyatı: ₺{o.store_products?.price}</span>
                  <span className="text-[#D4AF37]">Teklif: ₺{o.offered_unit_price}</span>
                </div>
                {o.status === 'pending' && (
                  counterInputFor === o.id ? (
                    <div className="flex gap-1.5 mt-1.5">
                      <input
                        type="number" placeholder="Karşı teklif ₺" value={counterValue}
                        onChange={(e) => setCounterValue(e.target.value)}
                        className="flex-1 bg-black/30 border border-[#2A3650] rounded px-2 py-1 text-white"
                      />
                      <button onClick={() => handleCounter(o.id)} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#D4AF37', color: '#000' }}>Gönder</button>
                      <button onClick={() => setCounterInputFor(null)} className="px-2 py-1 rounded text-[10px]" style={{ background: '#2A3650', color: '#A3B3D1' }}>Vazgeç</button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5 mt-1.5">
                      <button onClick={() => handleRespondOffer(o.id, 'accepted')} className="flex-1 rounded py-1 text-[10px] font-bold" style={{ background: '#10B981', color: '#fff' }}>Kabul Et</button>
                      <button onClick={() => setCounterInputFor(o.id)} className="flex-1 rounded py-1 text-[10px] font-bold" style={{ background: '#D4AF37', color: '#000' }}>Karşı Teklif</button>
                      <button onClick={() => handleRespondOffer(o.id, 'rejected')} className="flex-1 rounded py-1 text-[10px] font-bold" style={{ background: '#2A3650', color: '#A3B3D1' }}>Reddet</button>
                    </div>
                  )
                )}
                {o.status !== 'pending' && (
                  <p className="mt-1.5 text-[10px] text-[#5E7090]">
                    Durum: {o.status === 'accepted' ? 'Kabul edildi ✅' : o.status === 'countered' ? `Karşı teklif verildi (₺${o.counter_price})` : 'Reddedildi'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeCall && (
        <VideoCallModal callId={activeCall.id} peerLabel="Müşteri" onClose={() => setActiveCall(null)} />
      )}
    </div>
  );
}
