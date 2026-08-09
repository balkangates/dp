'use client';

/**
 * ProductSpotlight.tsx
 * ─────────────────────────────────────────────────────────────────────────
 * Müşteri bir ürünü sepete eklediğinde, canlı yayının olduğu alanda (solda)
 * kısa süreliğine o ürünün YouTube tanıtım videosu öne çıkarılır — gerçek
 * TV alışveriş kanallarındaki "az önce eklenen ürüne kamera odaklanır" hissi.
 * Süre dolunca (veya "Canlıya Dön" ile) otomatik olarak StoreLiveViewer'a
 * geri dönülür.
 */

import { useEffect, useState } from 'react';
import { getYoutubeEmbedUrl } from '@/lib/youtube';
import type { StoreProduct } from '@/lib/dampingvar';

const SPOTLIGHT_SECONDS = 25;

export default function ProductSpotlight({
  product,
  videoUrl,
  onBack,
}: {
  product: StoreProduct;
  videoUrl: string | null;
  onBack: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(SPOTLIGHT_SECONDS);
  const embedUrl = getYoutubeEmbedUrl(videoUrl, true);

  useEffect(() => {
    setSecondsLeft(SPOTLIGHT_SECONDS);
    const iv = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(iv);
          onBack();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  return (
    <div
      className="rounded-2xl overflow-hidden relative"
      style={{ background: '#000', border: '1px solid #D4AF37' }}
    >
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-[#D4AF37] px-2.5 py-1 rounded-md">
        <i className="fas fa-cart-shopping text-black text-[10px]" />
        <span className="text-black text-[10px] font-black font-mono">SEPETE EKLENDİ</span>
      </div>

      <button
        onClick={onBack}
        className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-black/60 hover:bg-black/80 px-3 py-1.5 rounded-md text-[10px] font-bold text-white font-mono transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        CANLIYA DÖN ({secondsLeft}s)
      </button>

      {embedUrl ? (
        <iframe
          src={embedUrl}
          title={product.name}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full aspect-video"
        />
      ) : product.image_url ? (
        <img src={product.image_url} alt={product.name} className="w-full aspect-video object-cover" />
      ) : (
        <div className="w-full aspect-video flex items-center justify-center">
          <p className="text-[#5E7090] text-xs font-mono">Bu ürün için video yok</p>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/90 to-transparent px-4 pt-8 pb-3">
        <p className="text-white font-black text-sm">{product.name}</p>
        <p className="text-[#D4AF37] font-mono font-extrabold text-sm">₺{product.price.toFixed(2)}</p>
      </div>
    </div>
  );
}
