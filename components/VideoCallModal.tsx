'use client';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack, type LocalTrack } from 'livekit-client';
import { getCallToken, endCall } from '@/lib/negotiation';

// Birebir görüntülü görüşme — hem müşteri hem bayi tarafında aynı bileşen
// kullanılıyor. call_requests.status='accepted' olduktan sonra her iki
// taraf da bunu mount ediyor; live-token Edge Function'ı role:'call' ile
// ikisine de canPublish:true veriyor (bkz. supabase/functions/live-token).
export default function VideoCallModal({
  callId,
  peerLabel,
  onClose,
}: {
  callId: string;
  peerLabel: string;
  onClose: () => void;
}) {
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const localTracksRef = useRef<LocalTrack[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { token, ws_url } = await getCallToken(callId);
        if (cancelled) return;

        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
            track.attach(remoteVideoRef.current);
          } else if (track.kind === Track.Kind.Audio) {
            const el = new Audio();
            track.attach(el);
          }
        });

        await room.connect(ws_url, token);
        if (cancelled) { room.disconnect(); return; }

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const published: LocalTrack[] = [];
        if (videoTrack) {
          const pub = await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.Camera });
          if (pub.track) published.push(pub.track);
        }
        if (audioTrack) {
          const pub = await room.localParticipant.publishTrack(audioTrack, { source: Track.Source.Microphone });
          if (pub.track) published.push(pub.track);
        }
        localTracksRef.current = published;
        setConnecting(false);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setConnecting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [callId]);

  const toggleMute = () => {
    localTracksRef.current
      .filter((t) => t.kind === Track.Kind.Audio)
      .forEach((t) => (muted ? t.unmute() : t.mute()));
    setMuted((m) => !m);
  };

  const toggleCamera = () => {
    localTracksRef.current
      .filter((t) => t.kind === Track.Kind.Video)
      .forEach((t) => (cameraOff ? t.unmute() : t.mute()));
    setCameraOff((c) => !c);
  };

  const hangUp = async () => {
    roomRef.current?.disconnect();
    try { await endCall(callId); } catch { /* zaten kapanmış olabilir */ }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl overflow-hidden" style={{ background: '#0B1220', border: '1px solid #2A3650' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #2A3650' }}>
          <p className="text-white font-bold text-sm">
            <i className="fas fa-video mr-2" style={{ color: '#D4AF37' }} />
            {peerLabel} ile görüntülü görüşme
          </p>
          <button onClick={hangUp} className="text-[#5E7090] hover:text-red-400"><i className="fas fa-xmark text-lg" /></button>
        </div>

        <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-3 right-3 w-32 rounded-lg border border-white/20 object-cover" />

          {connecting && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[#A3B3D1] text-xs font-mono"><i className="fas fa-spinner fa-spin mr-1.5" />Bağlanılıyor…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6">
              <p className="text-amber-400 text-xs font-mono text-center">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 py-3">
          <button
            onClick={toggleMute}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: muted ? '#EF4444' : '#1E2A42' }}
          >
            <i className={`fas ${muted ? 'fa-microphone-slash' : 'fa-microphone'} text-white text-sm`} />
          </button>
          <button
            onClick={toggleCamera}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: cameraOff ? '#EF4444' : '#1E2A42' }}
          >
            <i className={`fas ${cameraOff ? 'fa-video-slash' : 'fa-video'} text-white text-sm`} />
          </button>
          <button onClick={hangUp} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#EF4444' }}>
            <i className="fas fa-phone-slash text-white text-sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
