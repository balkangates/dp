'use client';
// components/LiveCallButton.tsx — CallAndNegotiation.tsx'teki "Görüntülü
// Görüş" tetikleyicisinin, video üzerine biner tek bir ikon olarak
// küçültülmüş hâli. "Satış Temsilcisiyle Görüş & Pazarlık Et" bölümünün
// TAMAMI (fiyat teklifi formu dahil) kaldırıldığı için, sadece
// call_requests akışını (istek gönder → bayi kabul eder → VideoCallModal
// açılır) koruyoruz — teklif formu bilinçli olarak burada YOK.
//
// lib/negotiation.ts DOKUNULMADI: dealer/live/page.tsx hâlâ aynı
// call_requests/negotiation_offers altyapısını kullanıyor, sadece
// müşteri tarafındaki TETİKLEYİCİ UI değişti.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { requestCall, type CallRequest } from '@/lib/negotiation';
import VideoCallModal from './VideoCallModal';

export default function LiveCallButton({
  storeId,
  storeName,
  customerId,
}: {
  storeId: string;
  storeName: string;
  customerId: string;
}) {
  const [pendingCall, setPendingCall] = useState<CallRequest | null>(null);
  const [activeCall, setActiveCall] = useState<CallRequest | null>(null);
  const [requesting, setRequesting] = useState(false);

  // Bekleyen görüşme isteğinin durumunu realtime izle (bayi kabul/red edince).
  useEffect(() => {
    if (!pendingCall) return;
    const channel = supabase
      .channel(`call-request-${pendingCall.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_requests', filter: `id=eq.${pendingCall.id}` },
        (payload) => {
          const row = payload.new as CallRequest;
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

  const handleRequestCall = async () => {
    if (requesting || pendingCall || activeCall) return;
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

  return (
    <>
      <button
        onClick={handleRequestCall}
        disabled={requesting || !!pendingCall}
        title={pendingCall ? `${storeName} yanıtlaması bekleniyor…` : 'Satış temsilcisiyle görüntülü görüş'}
        className="w-9 h-9 lg:w-10 lg:h-10 rounded-full flex items-center justify-center text-sm backdrop-blur-sm relative"
        style={{
          background: pendingCall ? 'rgba(245,158,11,0.25)' : 'rgba(0,0,0,0.45)',
          border: `1px solid ${pendingCall ? '#F59E0B' : 'rgba(255,255,255,0.14)'}`,
          color: pendingCall ? '#F59E0B' : '#fff',
        }}
      >
        <i className={`fas ${pendingCall ? 'fa-spinner fa-spin' : 'fa-video'}`} />
      </button>

      {activeCall && (
        <VideoCallModal callId={activeCall.id} peerLabel={storeName} onClose={() => setActiveCall(null)} />
      )}
    </>
  );
}
