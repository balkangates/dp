'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  requestCall, type CallRequest, submitOffer, getMyOffers, acceptCounter, respondToOffer,
} from '@/lib/negotiation';
import VideoCallModal from './VideoCallModal';
import type { StoreProduct } from '@/lib/dampingvar';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

export default function CallAndNegotiation({
  storeId,
  storeName,
  customerId,
  products,
}: {
  storeId: string;
  storeName: string;
  customerId: string;
  products: StoreProduct[];
}) {
  const [pendingCall, setPendingCall] = useState<CallRequest | null>(null);
  const [activeCall, setActiveCall] = useState<CallRequest | null>(null);
  const [requesting, setRequesting] = useState(false);

  const [offerProductId, setOfferProductId] = useState('');
  const [offerQty, setOfferQty] = useState(1);
  const [offerPrice, setOfferPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [myOffers, setMyOffers] = useState<any[]>([]);

  const refreshOffers = () => getMyOffers(customerId).then(setMyOffers).catch(() => {});
  useEffect(() => { refreshOffers(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [storeId]);

  // Bekleyen görüşme isteğinin durumunu realtime izle (bayi kabul/red edince).
  useEffect(() => {
    if (!pendingCall) return;
    const channel = supabase
      .channel(`call-request-${pendingCall.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_requests', filter: `id=eq.${pendingCall.id}` },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as any;
          if (row.status === 'accepted') {
            setActiveCall(row);
            setPendingCall(null);
          } else if (row.status === 'rejected') {
            alert('Bayi görüşme isteğinizi şu an kabul edemedi.');
            setPendingCall(null);
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [pendingCall]);

  // Tekliflerimin durumunu realtime izle (bayi yanıtlayınca).
  useEffect(() => {
    const channel = supabase
      .channel(`my-offers-${customerId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'negotiation_offers', filter: `customer_id=eq.${customerId}` },
        () => refreshOffers())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const handleRequestCall = async () => {
    setRequesting(true);
    try {
      const call = await requestCall(storeId, customerId);
      setPendingCall(call);
    } catch (e) {
      alert('Görüşme isteği gönderilemedi: ' + (e as Error).message);
    } finally {
      setRequesting(false);
    }
  };

  const handleSubmitOffer = async () => {
    const price = Number(offerPrice);
    if (!offerProductId || !price || price <= 0) {
      alert('Ürün ve geçerli bir fiyat girin.');
      return;
    }
    setSubmitting(true);
    try {
      await submitOffer({
        storeProductId: offerProductId,
        customerId,
        quantity: offerQty,
        offeredUnitPrice: price,
        callRequestId: activeCall?.id,
      });
      setOfferPrice('');
      refreshOffers();
    } catch (e) {
      alert('Teklif gönderilemedi: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptCounter = async (offerId: string, counterPrice: number) => {
    try {
      await acceptCounter(offerId, counterPrice);
      refreshOffers();
    } catch (e) {
      alert('İşlem başarısız: ' + (e as Error).message);
    }
  };

  const handleRejectCounter = async (offerId: string) => {
    try {
      await respondToOffer(offerId, 'rejected');
      refreshOffers();
    } catch (e) {
      alert('İşlem başarısız: ' + (e as Error).message);
    }
  };

  const statusLabel: Record<string, string> = {
    pending: 'Yanıt bekleniyor',
    accepted: 'Kabul edildi ✅',
    rejected: 'Reddedildi',
    countered: 'Karşı teklif geldi',
    expired: 'Süresi doldu',
  };

  return (
    <div className="rounded-2xl p-4 space-y-4" style={CARD}>
      <div className="flex items-center justify-between">
        <p className="text-white font-extrabold text-sm">Satış Temsilcisiyle Görüş & Pazarlık Et</p>
        {!activeCall && (
          <button
            onClick={handleRequestCall}
            disabled={requesting || !!pendingCall}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold flex items-center gap-1.5"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', opacity: requesting || pendingCall ? 0.6 : 1 }}
          >
            <i className="fas fa-video" />
            {pendingCall ? 'İstek gönderildi…' : 'Görüntülü Görüş'}
          </button>
        )}
      </div>

      {pendingCall && (
        <p className="text-[11px] text-amber-400 font-mono">
          <i className="fas fa-spinner fa-spin mr-1.5" />
          {storeName} satış temsilcisinin isteğinizi kabul etmesi bekleniyor…
        </p>
      )}

      <div className="space-y-2">
        <p className="text-[#A3B3D1] text-xs font-bold">Fiyat Teklifi Ver</p>
        <div className="grid grid-cols-[1fr_70px_90px] gap-1.5">
          <select
            value={offerProductId}
            onChange={(e) => setOfferProductId(e.target.value)}
            className="bg-black/30 border border-[#2A3650] rounded-lg px-2 py-1.5 text-xs text-white"
          >
            <option value="">Ürün seç…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (liste: ₺{p.price})</option>
            ))}
          </select>
          <input
            type="number" min={1} value={offerQty}
            onChange={(e) => setOfferQty(Number(e.target.value))}
            className="bg-black/30 border border-[#2A3650] rounded-lg px-2 py-1.5 text-xs text-white"
          />
          <input
            type="number" placeholder="₺ Teklif" value={offerPrice}
            onChange={(e) => setOfferPrice(e.target.value)}
            className="bg-black/30 border border-[#2A3650] rounded-lg px-2 py-1.5 text-xs text-white"
          />
        </div>
        <button
          onClick={handleSubmitOffer}
          disabled={submitting}
          className="w-full rounded-lg py-2 text-xs font-bold"
          style={{ border: '1px solid #D4AF37', color: '#D4AF37' }}
        >
          {submitting ? '…' : 'Teklifi Gönder'}
        </button>
      </div>

      {myOffers.length > 0 && (
        <div className="space-y-1.5 pt-2" style={{ borderTop: '1px dashed #2A3650' }}>
          <p className="text-[#A3B3D1] text-xs font-bold">Tekliflerim</p>
          {myOffers.map((o) => (
            <div key={o.id} className="rounded-lg p-2 text-[11px]" style={{ background: '#0B1220', border: '1px solid #1E2A42' }}>
              <div className="flex justify-between">
                <span className="text-white">{o.store_products?.name} × {o.quantity}</span>
                <span className="text-[#5E7090] font-mono">{statusLabel[o.status] ?? o.status}</span>
              </div>
              <div className="flex justify-between mt-1 text-[#5E7090] font-mono">
                <span>Teklifim: ₺{o.offered_unit_price}</span>
                {o.status === 'countered' && o.counter_price && (
                  <span className="text-[#D4AF37]">Karşı teklif: ₺{o.counter_price}</span>
                )}
              </div>
              {o.status === 'countered' && o.counter_price && (
                <div className="flex gap-1.5 mt-1.5">
                  <button onClick={() => handleAcceptCounter(o.id, o.counter_price)} className="flex-1 rounded py-1 text-[10px] font-bold" style={{ background: '#10B981', color: '#fff' }}>Kabul Et</button>
                  <button onClick={() => handleRejectCounter(o.id)} className="flex-1 rounded py-1 text-[10px] font-bold" style={{ background: '#2A3650', color: '#A3B3D1' }}>Reddet</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeCall && (
        <VideoCallModal callId={activeCall.id} peerLabel={storeName} onClose={() => setActiveCall(null)} />
      )}
    </div>
  );
}
