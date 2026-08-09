'use client';

/**
 * VideoPopupModal.tsx — canlı satış ürün kartındaki "Detay" butonuna tıklanınca
 * açılan saydam YouTube video popup'ı. Sağ üstte kalp/alev/alkış reaksiyon
 * ikonları vardır. Video bittiğinde popup otomatik kapanır.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => {
        destroy: () => void;
      };
      PlayerState: { ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prevReady?.(); resolve(); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

const REACTIONS = [
  { key: 'heart', icon: '❤️' },
  { key: 'fire', icon: '🔥' },
  { key: 'clap', icon: '👏' },
];

export default function VideoPopupModal({ videoUrl, title, onClose }: { videoUrl: string; title?: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<{ destroy: () => void } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({ heart: 0, fire: 0, clap: 0 });
  const [pops, setPops] = useState<{ id: number; key: string }[]>([]);
  const videoId = extractYouTubeId(videoUrl);

  useEffect(() => {
    let cancelled = false;
    if (!videoId || !containerRef.current) return;

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1 },
        events: {
          onStateChange: (e: { data: number }) => {
            if (window.YT && e.data === window.YT.PlayerState.ENDED) onClose();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const react = (key: string) => {
    setCounts((c) => ({ ...c, [key]: c[key] + 1 }));
    const id = Date.now() + Math.random();
    setPops((p) => [...p, { id, key }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1200);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{ background: 'rgba(6,9,16,0.75)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
          className="relative w-full max-w-2xl rounded-2xl overflow-hidden"
          style={{ background: 'rgba(19,28,44,0.55)', border: '1px solid rgba(212,175,55,0.3)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Üst bar: başlık + kapat */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <p className="text-white font-bold text-sm truncate pr-3">{title ?? 'Ürün Tanıtımı'}</p>
            <button onClick={onClose} className="text-[#5E7090] hover:text-white text-lg leading-none cursor-pointer">✕</button>
          </div>

          {/* Reaksiyon ikonları — sağ üst */}
          <div className="absolute top-12 right-3 z-10 flex flex-col items-center gap-3">
            {REACTIONS.map((r) => (
              <button
                key={r.key}
                onClick={() => react(r.key)}
                className="relative w-11 h-11 rounded-full flex items-center justify-center text-xl cursor-pointer hover:scale-110 transition-transform"
                style={{ background: 'rgba(9,13,22,0.55)', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                {r.icon}
                <AnimatePresence>
                  {pops.filter((p) => p.key === r.key).map((p) => (
                    <motion.span
                      key={p.id}
                      initial={{ opacity: 1, y: 0, scale: 1 }}
                      animate={{ opacity: 0, y: -40, scale: 1.4 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.1 }}
                      className="absolute -top-2 text-lg pointer-events-none"
                    >
                      {r.icon}
                    </motion.span>
                  ))}
                </AnimatePresence>
                <span className="absolute -bottom-1.5 -right-1 text-[9px] font-mono font-bold text-[#D4AF37] bg-black/70 rounded-full px-1">
                  {counts[r.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Video */}
          <div className="aspect-video w-full">
            {videoId ? (
              <div ref={containerRef} className="w-full h-full" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#5E7090] text-sm font-mono">
                Video linki okunamadı.
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
