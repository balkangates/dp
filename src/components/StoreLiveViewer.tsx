/**
 * StoreLiveViewer.tsx
 * ─────────────────────────────────────────────────────────────────────────
 * Müşterinin seçtiği MAĞAZAYA ÖZEL canlı yayın izleyicisi.
 *
 * Önceden App.tsx'in en üstündeki <LiveStream /> tek/sabit bir konuşma
 * (LIVE_CONV_ID) üzerinden platform geneli bir "canlı sohbet" gösteriyordu
 * — hangi bayi seçilirse seçilsin hep aynı şeydi, gerçek kamera görüntüsü
 * de yoktu. Bu bileşen bunun yerine:
 *
 *   1) Seçili mağazanın stores.is_live durumunu GERÇEK ZAMANLI izler
 *      (Supabase Realtime — bayi "Canlıya Geç"e bastığında anında yansır).
 *   2) is_live=true olduğunda, dealer'ın (dashboard.html →
 *      modules/live-sales.js) LiveKit'e yayınladığı "store-<id>" odasına
 *      SADECE İZLEYİCİ olarak bağlanır ve kamera görüntüsünü render eder.
 *   3) is_live=false olduğunda basit bir "şu an canlı değil" durumu
 *      gösterir (ürün bazlı YouTube tanıtım videoları zaten ProductCard
 *      üzerinden ayrıca izlenebiliyor).
 *
 * DIŞ BAĞIMLILIK: supabase/functions/live-token adlı bir Edge Function
 * deploy edilmiş olmalı (bkz. proje köküne eklenen
 * supabase/functions/live-token/index.ts). O olmadan bu bileşen sadece
 * "izleme token'ı alınamadı" hatası gösterir — mağaza seçimi/ürün/sepet
 * akışı etkilenmez.
 */

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { supabase, getLiveViewerToken } from '../lib/supabase';

export default function StoreLiveViewer({
  storeId,
  storeName,
  initialIsLive,
}: {
  storeId: string;
  storeName: string;
  initialIsLive: boolean;
}) {
  const [isLive, setIsLive] = useState(initialIsLive);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);

  // Mağaza değişince state'i sıfırla.
  useEffect(() => {
    setIsLive(initialIsLive);
    setViewerError(null);
  }, [storeId, initialIsLive]);

  // stores.is_live GERÇEK ZAMANLI — bayi yayını açtığı/kapattığı anda yansır.
  useEffect(() => {
    const channel = supabase
      .channel(`store-live-${storeId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'stores', filter: `id=eq.${storeId}` },
        (payload) => {
          const live = Boolean((payload.new as { is_live?: boolean })?.is_live);
          setIsLive(live);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  // is_live true olunca LiveKit odasına izleyici olarak bağlan, false olunca ayrıl.
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      setConnecting(true);
      setViewerError(null);
      try {
        const { token, ws_url } = await getLiveViewerToken(storeId);
        if (cancelled) return;

        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
          } else if (track.kind === Track.Kind.Audio && audioRef.current) {
            track.attach(audioRef.current);
          }
        });
        room.on(RoomEvent.Disconnected, () => {
          if (!cancelled) setConnected(false);
        });

        await room.connect(ws_url, token);
        if (cancelled) {
          room.disconnect();
          return;
        }
        setConnected(true);
      } catch (err) {
        if (!cancelled) setViewerError((err as Error).message);
      } finally {
        if (!cancelled) setConnecting(false);
      }
    }

    function disconnect() {
      roomRef.current?.disconnect();
      roomRef.current = null;
      setConnected(false);
    }

    if (isLive) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      cancelled = true;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, storeId]);

  if (!isLive) {
    return (
      <div
        className="rounded-2xl p-6 text-center"
        style={{ background: '#131C2C', border: '1px solid #2A3650' }}
      >
        <p className="text-[#5E7090] text-sm font-mono">
          <i className="fas fa-video-slash mr-1.5" />
          {storeName} şu an canlı yayında değil.
        </p>
        <p className="text-[#3A4A65] text-[11px] font-mono mt-1">
          Ürünlerin YouTube tanıtım videolarını "Detay" butonundan izleyebilirsin.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl overflow-hidden relative"
      style={{ background: '#000', border: '1px solid #2A3650' }}
    >
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-red-500/90 px-2.5 py-1 rounded-md">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        <span className="text-white text-[10px] font-black font-mono">CANLI · {storeName}</span>
      </div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full aspect-video object-cover bg-black"
      />
      <audio ref={audioRef} autoPlay />

      {(connecting || (!connected && !viewerError)) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <p className="text-[#A3B3D1] text-xs font-mono">
            <i className="fas fa-spinner fa-spin mr-1.5" /> Yayına bağlanılıyor…
          </p>
        </div>
      )}

      {viewerError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-4">
          <p className="text-amber-400 text-[11px] font-mono text-center">
            Canlı görüntüye şu an bağlanılamıyor: {viewerError}
            <br />
            Mağaza yine de canlı — sipariş verebilirsin.
          </p>
        </div>
      )}
    </div>
  );
}
