'use client';
// components/StoreShopOverlay.tsx — canlı yayın videosunun ÜZERİNE binen
// TikTok-live-shop tarzı alışveriş katmanı — TÜM ekran boyutlarında
// (mobil dahil) video üzerinde absolute overlay olarak render edilir.
//
// Mobilde overlay'e yer açmak için StoreLiveViewer'daki video artık daha
// dikey (aspect-[4/5]) — düz 16:9'da TikTok tarzı üst üste binen ikonlara
// yer yoktu. Üst filtre çubuğu, StoreLiveViewer'ın "CANLI · {storeName}"
// rozetiyle çakışmasın diye top-11'den başlıyor (rozet top-3'te, ~26px
// yüksekliğinde bitiyor).
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import CartAndCheckout from './CartAndCheckout';
import ProductCard from './ProductCard';
import LiveCallButton from './LiveCallButton';
import type { StoreProduct, CartLine, Category, Sector, Subcategory } from '@/lib/dampingvar';

function FilterPill({
  icon, label, selectedLabel, options, onSelect, disabled,
}: {
  icon: string;
  label: string;
  selectedLabel: string | null;
  options: { id: string; label: string }[];
  onSelect: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 lg:px-2.5 lg:py-1.5 rounded-full text-[9px] lg:text-[10px] font-bold backdrop-blur-sm whitespace-nowrap disabled:opacity-40"
        style={{
          background: selectedLabel ? 'rgba(212,175,55,0.22)' : 'rgba(0,0,0,0.45)',
          border: `1px solid ${selectedLabel ? '#D4AF37' : 'rgba(255,255,255,0.14)'}`,
          color: selectedLabel ? '#D4AF37' : '#fff',
        }}
      >
        <i className={`fas ${icon}`} />
        <span className="max-w-[64px] lg:max-w-[80px] truncate">{selectedLabel ?? label}</span>
        <i className="fas fa-chevron-down text-[6px] lg:text-[7px]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1.5 z-50 rounded-xl overflow-hidden max-h-56 overflow-y-auto min-w-[150px]"
            style={{ background: '#0B1220', border: '1px solid #2A3650' }}
          >
            <button
              onClick={() => { onSelect(null); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-[11px] text-[#5E7090] hover:bg-white/5"
            >
              Tümü
            </button>
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => { onSelect(o.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-[11px] text-white hover:bg-white/5"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function StoreShopOverlay({
  storeId,
  storeName,
  sectors,
  categories,
  subcategories,
  activeSector,
  activeCategory,
  activeSubcategory,
  setActiveSector,
  setActiveCategory,
  setActiveSubcategory,
  products,
  spotlightProductId,
  cart,
  setCart,
  onOrdered,
}: {
  storeId: string;
  storeName: string;
  sectors: Sector[];
  categories: Category[];
  subcategories: Subcategory[];
  activeSector: string | null;
  activeCategory: string | null;
  activeSubcategory: string | null;
  setActiveSector: (id: string | null) => void;
  setActiveCategory: (id: string | null) => void;
  setActiveSubcategory: (id: string | null) => void;
  products: StoreProduct[];
  spotlightProductId: string | null;
  cart: CartLine[];
  setCart: (c: CartLine[]) => void;
  onOrdered: () => void;
}) {
  const { user } = useAuth();
  const [showCart, setShowCart] = useState(false);

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const addToCart = (p: StoreProduct) => {
    setCart(
      cart.some((i) => i.store_product_id === p.id)
        ? cart.map((i) => (i.store_product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...cart, { store_product_id: p.id, product_name: p.name, unit_price: p.price, quantity: 1 }],
    );
  };

  const buyNow = (p: StoreProduct) => {
    addToCart(p);
    setShowCart(true);
  };

  const categoryOptions = categories
    .filter((c) => !activeSector || c.sector_id === activeSector)
    .map((c) => ({ id: c.id, label: c.name }));
  const subcategoryOptions = subcategories
    .filter((s) => s.category_id === activeCategory)
    .map((s) => ({ id: s.id, label: s.name }));

  return (
    <>
      {/* ── Üst filtre çubuğu: Sektör / Kategori / Alt Kategori ──
          top-11: StoreLiveViewer'ın "CANLI · {storeName}" rozeti top-3'te
          başlayıp ~26px yükseklikte bitiyor, çakışmasın diye altından
          başlıyoruz. */}
      {sectors.length > 0 && (
        <div className="absolute top-11 left-2 lg:left-3 z-30 flex flex-wrap gap-1 lg:gap-1.5 max-w-[62%]">
          <FilterPill
            icon="fa-industry"
            label="Sektör"
            selectedLabel={sectors.find((s) => s.id === activeSector)?.label ?? null}
            options={sectors.map((s) => ({ id: s.id, label: s.label }))}
            onSelect={(id) => { setActiveSector(id); setActiveCategory(null); setActiveSubcategory(null); }}
          />
          <FilterPill
            icon="fa-tags"
            label="Kategori"
            selectedLabel={categories.find((c) => c.id === activeCategory)?.name ?? null}
            options={categoryOptions}
            onSelect={(id) => { setActiveCategory(id); setActiveSubcategory(null); }}
          />
          <FilterPill
            icon="fa-layer-group"
            label="Alt Kategori"
            selectedLabel={subcategories.find((s) => s.id === activeSubcategory)?.name ?? null}
            options={subcategoryOptions}
            onSelect={setActiveSubcategory}
            disabled={!activeCategory}
          />
        </div>
      )}

      {/* ── Üst-sağ: Sepet + Görüntülü Görüş ── */}
      <div className="absolute top-2 lg:top-3 right-2 lg:right-3 z-30 flex items-center gap-1.5 lg:gap-2">
        {user && <LiveCallButton storeId={storeId} storeName={storeName} customerId={user.id} />}
        <button
          onClick={() => setShowCart(true)}
          className="relative w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center text-xs lg:text-sm backdrop-blur-sm"
          style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.14)', color: '#fff' }}
        >
          <i className="fas fa-cart-shopping" />
          {cartCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[15px] h-[15px] lg:min-w-[16px] lg:h-4 px-1 rounded-full flex items-center justify-center text-[8px] lg:text-[9px] font-black"
              style={{ background: '#EF4444', color: '#fff' }}
            >
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Alt: yatay kaydırmalı ürün şeridi (video footer) — sağda
          StoreSocialBar'ın dikey ikon sütununa (≈52px) çarpmasın diye
          right-14 boşluk bırakılıyor. ── */}
      {products.length > 0 && (
        <div className="absolute bottom-2 lg:bottom-3 left-2 lg:left-3 right-14 lg:right-16 z-30 flex gap-1.5 lg:gap-2 overflow-x-auto no-scrollbar">
          {[...products]
            .sort((a, b) => (a.id === spotlightProductId ? -1 : b.id === spotlightProductId ? 1 : 0))
            .map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAdd={addToCart}
                onBuyNow={buyNow}
                compact
                isSpotlight={p.id === spotlightProductId}
              />
            ))}
        </div>
      )}

      {/* ── Sepet / Ödeme paneli — videonun ÜZERİNE, tüm ekran boyutlarında
          sabit bottom-sheet olarak açılır. ── */}
      {showCart && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowCart(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full lg:max-w-sm" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <CartAndCheckout
              storeId={storeId}
              cart={cart}
              setCart={setCart}
              onOrdered={() => { onOrdered(); setShowCart(false); }}
              onClose={() => setShowCart(false)}
            />
          </div>
        </>
      )}
    </>
  );
}
