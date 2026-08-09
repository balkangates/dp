'use client';
import { useEffect, useState } from 'react';
import { getProductVideo, type StoreProduct } from '@/lib/dampingvar';
import VideoPopupModal from './VideoPopupModal';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

// mm:ss geri sayım — flash_price_ends_at geçince otomatik "bitti" döner,
// üst bileşen (ProductCard) o zaman flash fiyatı zaten görmezden geliyor.
function useCountdown(endsAt: string | null) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!endsAt) { setLabel(null); return; }
    const tick = () => {
      const ms = new Date(endsAt).getTime() - Date.now();
      if (ms <= 0) { setLabel(null); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setLabel(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [endsAt]);
  return label;
}

export default function ProductCard({
  product,
  onAdd,
  onBuyNow,
  compact = false,
  isSpotlight = false,
}: {
  product: StoreProduct;
  onAdd: (p: StoreProduct) => void;
  // "Satın Al" — sepete ekleyip doğrudan ödeme panelini açar (bkz.
  // app/store/[storeId]/page.tsx → buyNow). Verilmezse buton gizlenir.
  onBuyNow?: (p: StoreProduct) => void;
  // compact=true: video altındaki yatay kaydırmalı şeritte kullanılan
  // küçültülmüş, sabit genişlikli kart görünümü (bkz. StoreShopOverlay).
  compact?: boolean;
  // isSpotlight=true: bayi bu ürünü "öne çıkardı" (canlı yayında şu an
  // anlattığı ürün) — kart altın çerçeveyle vurgulanır.
  isSpotlight?: boolean;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const countdown = useCountdown(product.flash_price_ends_at);
  const flashActive = product.flash_price != null && countdown != null;
  const displayPrice = flashActive ? product.flash_price! : product.price;

  const openDetail = async () => {
    setLoadingVideo(true);
    try {
      const v = await getProductVideo(product.id);
      setVideoUrl(v?.video_url ?? null);
    } finally {
      setLoadingVideo(false);
    }
  };

  const handleAdd = () => {
    onAdd(product);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
  };

  const lowStock = product.stock_qty > 0 && product.stock_qty <= 5;

  if (compact) {
    return (
      <div
        className="shrink-0 w-[86px] lg:w-[132px] rounded-lg lg:rounded-xl overflow-hidden backdrop-blur-sm transition-transform"
        style={{
          background: 'rgba(19,28,44,0.92)',
          border: isSpotlight ? '1.5px solid #D4AF37' : '1px solid rgba(42,54,80,0.9)',
          boxShadow: isSpotlight ? '0 0 0 3px rgba(212,175,55,0.25)' : undefined,
          transform: isSpotlight ? 'scale(1.04)' : undefined,
        }}
      >
        <div className="relative">
          {isSpotlight && (
            <span className="absolute top-0 left-0 right-0 z-10 text-center text-[6px] lg:text-[7px] font-black py-0.5" style={{ background: '#D4AF37', color: '#000' }}>
              <i className="fas fa-bullhorn mr-0.5" />CANLI ANLATIYOR
            </span>
          )}
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- ürün görselleri dış/dinamik kaynaklardan geliyor
            <img src={product.image_url} alt={product.name} className="w-full h-9 lg:h-16 object-cover" />
          ) : (
            <div className="w-full h-9 lg:h-16 flex items-center justify-center bg-black/40">
              <i className="fas fa-image text-[#2A3650] text-xs lg:text-sm" />
            </div>
          )}
          {product.has_video && (
            <button
              onClick={openDetail}
              disabled={loadingVideo}
              className="absolute top-0.5 right-0.5 lg:top-1 lg:right-1 w-4 h-4 lg:w-5 lg:h-5 rounded-full bg-black/70 flex items-center justify-center text-white text-[7px] lg:text-[8px]"
              title="Tanıtım videosunu izle"
            >
              <i className={loadingVideo ? 'fas fa-spinner fa-spin' : 'fas fa-play'} />
            </button>
          )}
          {lowStock && (
            <span className="absolute bottom-0.5 left-0.5 lg:bottom-1 lg:left-1 bg-red-500/90 text-white text-[6px] lg:text-[7px] font-black px-1 py-0.5 rounded">
              SON {product.stock_qty}
            </span>
          )}
        </div>
        <div className="p-1 lg:p-1.5">
          <p className="text-white text-[8px] lg:text-[10px] font-bold leading-snug line-clamp-2 min-h-[2.2em]">{product.name}</p>

          {flashActive ? (
            <div className="mt-0.5">
              <div className="flex items-center gap-1">
                <span className="text-[#5E7090] text-[7px] lg:text-[8px] line-through">₺{product.price.toFixed(0)}</span>
                <span className="text-[7px] lg:text-[8px] font-black px-1 rounded" style={{ background: '#EF4444', color: '#fff' }}>
                  <i className="fas fa-bolt" /> {countdown}
                </span>
              </div>
              <p className="text-[#10B981] font-mono font-black text-[9px] lg:text-[11px]">₺{displayPrice.toFixed(2)}</p>
            </div>
          ) : (
            <p className="text-[#D4AF37] font-mono font-black text-[9px] lg:text-[11px] mt-0.5">₺{displayPrice.toFixed(2)}</p>
          )}

          {product.purchase_count > 0 && (
            <p className="text-[#5E7090] text-[6px] lg:text-[7px] mt-0.5">
              <i className="fas fa-fire text-[#F59E0B]" /> {product.purchase_count} kişi aldı
            </p>
          )}

          <div className="flex gap-1 mt-1 lg:mt-1.5">
            <button
              onClick={handleAdd}
              className="flex-1 rounded py-0.5 lg:py-1 text-[8px] lg:text-[9px] font-extrabold flex items-center justify-center"
              style={justAdded ? { background: '#10B981', color: '#fff' } : { background: 'rgba(212,175,55,0.16)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.4)' }}
            >
              <i className={justAdded ? 'fas fa-check' : 'fas fa-cart-plus'} />
            </button>
            {onBuyNow && (
              <button
                onClick={() => onBuyNow(product)}
                className="flex-1 rounded py-0.5 lg:py-1 text-[8px] lg:text-[9px] font-extrabold"
                style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000' }}
              >
                Al
              </button>
            )}
          </div>
        </div>
        {videoUrl && (
          <VideoPopupModal videoUrl={videoUrl} title={product.name} onClose={() => setVideoUrl(null)} />
        )}
      </div>
    );
  }

  return (
    <div
      className="group rounded-xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5"
      style={{ ...CARD, boxShadow: '0 1px 3px rgba(0,0,0,0.3)', borderColor: isSpotlight ? '#D4AF37' : undefined }}
    >
      <div className="relative">
        {isSpotlight && (
          <span className="absolute top-0 left-0 right-0 z-10 text-center text-[9px] font-black py-1" style={{ background: '#D4AF37', color: '#000' }}>
            <i className="fas fa-bullhorn mr-1" />ŞU AN CANLI ANLATILIYOR
          </span>
        )}
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- ürün görselleri dış/dinamik kaynaklardan geliyor
          <img src={product.image_url} alt={product.name} className="w-full h-32 object-cover" />
        ) : (
          <div className="w-full h-32 flex items-center justify-center bg-[#0B1220]">
            <i className="fas fa-image text-[#2A3650] text-2xl" />
          </div>
        )}

        {product.has_video && (
          <button
            onClick={openDetail}
            disabled={loadingVideo}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white text-[10px] hover:bg-black/80 transition-colors"
            title="Tanıtım videosunu izle"
          >
            <i className={loadingVideo ? 'fas fa-spinner fa-spin' : 'fas fa-play'} />
          </button>
        )}

        {lowStock && (
          <span className="absolute bottom-2 left-2 bg-red-500/90 text-white text-[9px] font-black font-mono px-2 py-0.5 rounded">
            SON {product.stock_qty} ADET
          </span>
        )}
      </div>

      <div className="p-3">
        <p className="text-white text-xs font-bold leading-snug line-clamp-2 min-h-[2.2em]">
          {product.name} {product.unit_size}{product.unit}
        </p>
        {product.category_name && (
          <p className="text-[#5E7090] text-[10px] font-mono mt-0.5">{product.category_name}</p>
        )}

        {flashActive ? (
          <div className="flex items-center gap-2 mt-2.5">
            <span className="text-[#5E7090] text-xs line-through">₺{product.price.toFixed(2)}</span>
            <span className="text-[#10B981] font-mono font-black text-base">₺{displayPrice.toFixed(2)}</span>
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: '#EF4444', color: '#fff' }}>
              <i className="fas fa-bolt" />{countdown}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-2.5">
            <span className="text-[#D4AF37] font-mono font-black text-base">₺{displayPrice.toFixed(2)}</span>
          </div>
        )}

        {product.purchase_count > 0 && (
          <p className="text-[#5E7090] text-[10px] font-mono mt-1">
            <i className="fas fa-fire text-[#F59E0B] mr-1" />{product.purchase_count} kişi bu ürünü aldı
          </p>
        )}

        <div className="flex gap-1.5 mt-2.5">
          <button
            onClick={handleAdd}
            className="flex-1 rounded-lg py-2 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all"
            style={
              justAdded
                ? { background: '#10B981', color: '#fff' }
                : { background: 'rgba(212,175,55,0.14)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.4)' }
            }
          >
            <i className={justAdded ? 'fas fa-check' : 'fas fa-cart-plus'} />
            {justAdded ? 'Eklendi' : 'Sepete Ekle'}
          </button>
          {onBuyNow && (
            <button
              onClick={() => onBuyNow(product)}
              className="flex-1 rounded-lg py-2 text-xs font-extrabold"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000' }}
            >
              Satın Al
            </button>
          )}
        </div>
      </div>

      {videoUrl && (
        <VideoPopupModal videoUrl={videoUrl} title={product.name} onClose={() => setVideoUrl(null)} />
      )}
    </div>
  );
}
