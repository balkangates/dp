/**
 * CustomerHome.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Customer flow: geo-detect nearest stores → pick one → browse its live
 * catalog → cart → place order (cash or card/POS at delivery).
 *
 * This is a new, DB-backed flow built against store_products/store_orders
 * (supabase_migration_v5_dampingvar.sql). The existing ProductGrid/CartSidebar
 * components run off static demo data (src/data.ts) for the current
 * storefront — wiring those to be per-store/DB-backed is a separate,
 * larger refactor and intentionally not silently done here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getCurrentPosition, getNearestStores, getAllStores, type NearbyStore } from '../lib/geo';
import { getStoreProducts, placeOrder, getMyOrders, getCategories, getProductVideo, getStoreActiveAuctions, type StoreProduct, type CartLine, type Category, type StoreWholesaleAuction } from '../lib/dampingvar';
import VideoPopupModal from './VideoPopupModal';
import StoreLiveViewer from './StoreLiveViewer';
import LiveStream from './LiveStream';

function timeLeft(endTime: string) {
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return 'Süresi doldu';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}sa ${m}dk`;
}

// FAZ B — mağazanın canlı toptan ihale süreci. SupplierPanel.tsx'teki
// AuctionCard ile AYNI görsel tasarım (azalan teklif) — ama burada teklif
// input'u YOK, sadece izleyici görünümü. Customer bilgilenir, bekler;
// teklif vermek sadece tedarikçilere açık (dashboard.html üzerinden).
function StoreAuctionsSection({ storeId }: { storeId: string }) {
  const [auctions, setAuctions] = useState<StoreWholesaleAuction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getStoreActiveAuctions(storeId)
      .then((a) => { if (alive) setAuctions(a); })
      .catch(() => { if (alive) setAuctions([]); })
      .finally(() => { if (alive) setLoading(false); });
    const iv = setInterval(() => {
      getStoreActiveAuctions(storeId).then((a) => { if (alive) setAuctions(a); }).catch(() => {});
    }, 20000);
    return () => { alive = false; clearInterval(iv); };
  }, [storeId]);

  if (loading || auctions.length === 0) return null;

  return (
    <div className="rounded-2xl p-5" style={CARD}>
      <p className="text-white font-extrabold text-sm mb-3">
        <i className="fas fa-gavel mr-1.5" style={{ color: '#D4AF37' }} />
        Bu Mağazanın Canlı Toptan İhaleleri
      </p>
      <div className="grid md:grid-cols-2 gap-3">
        {auctions.map((a) => (
          <div key={a.reverse_auction_id} className="rounded-xl p-4 space-y-2" style={{ background: '#0B1220', border: '1px solid #2A3650' }}>
            <div className="flex items-center justify-between">
              <p className="text-white font-extrabold text-sm">{a.product_name}</p>
              <span className="text-[10px] font-mono text-[#D4AF37]">{timeLeft(a.end_time)}</span>
            </div>
            <p className="text-[11px] text-[#5E7090] font-mono">
              Toplam {a.total_quantity} {a.quantity_unit} · Tavan fiyat ₺{a.ceiling_price}/birim
            </p>
            <div className="rounded-lg bg-black/30 px-3 py-2 text-[11px] font-mono flex items-center justify-between">
              <span className="text-[#A3B3D1]">{a.bid_count} tedarikçi teklif verdi</span>
              {a.lowest_price != null && (
                <span className="text-[#10B981] font-bold">En iyi teklif: ₺{a.lowest_price}</span>
              )}
            </div>
            <p className="text-[10px] text-[#3A4A65] font-mono italic">Sadece tedarikçiler teklif verebilir.</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

function StoreSelector({ onSelect }: { onSelect: (store: NearbyStore) => void }) {
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pos = await getCurrentPosition();
        const nearby = await getNearestStores(pos.lat, pos.lng, 20);
        setStores(nearby);
      } catch (err) {
        setError((err as Error).message);
        // No distance sort available without geo access — still let the
        // customer pick a store manually from the full active list.
        try {
          const all = await getAllStores(20);
          setStores(
            all.map((s) => ({
              store_id: s.id,
              name: s.name,
              address: s.address,
              lat: s.lat ?? 0,
              lng: s.lng ?? 0,
              is_live: s.is_live,
              distance_km: NaN,
            })),
          );
        } catch {
          /* no fallback available either — show the error above */
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-[#5E7090] font-mono text-sm py-10 text-center">Konum alınıyor…</div>;

  return (
    <div className="space-y-3">
      <h2 className="text-white font-black text-xl">📍 Mağaza Seç</h2>
      {error && <p className="text-[11px] text-amber-400 font-mono">{error}</p>}
      {stores.length === 0 ? (
        <p className="text-[#5E7090] text-sm font-mono">Yakınında mağaza bulunamadı.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {stores.map((s) => (
            <button
              key={s.store_id}
              onClick={() => onSelect(s)}
              className="text-left rounded-xl p-4 hover:border-[#D4AF37]/60 transition-colors"
              style={CARD}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-white font-extrabold text-sm">{s.name}</p>
                {s.is_live && (
                  <span className="text-[9px] font-mono font-bold text-red-400 bg-red-500/15 px-2 py-0.5 rounded">
                    ● CANLI
                  </span>
                )}
              </div>
              <p className="text-[#5E7090] text-[11px] font-mono">{s.address ?? '—'}</p>
              {Number.isFinite(s.distance_km) && (
                <p className="text-[#D4AF37] text-[11px] font-mono mt-1">{s.distance_km.toFixed(1)} km</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({ product, onAdd }: { product: StoreProduct; onAdd: (p: StoreProduct) => void }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);

  const openDetail = async () => {
    setLoadingVideo(true);
    try {
      const v = await getProductVideo(product.id);
      setVideoUrl(v?.video_url ?? null);
    } finally {
      setLoadingVideo(false);
    }
  };

  return (
    <div className="rounded-xl p-3" style={CARD}>
      {product.image_url && (
        <img src={product.image_url} alt={product.name} className="w-full h-28 object-cover rounded-lg mb-2" />
      )}
      <p className="text-white text-xs font-bold">{product.name} {product.unit_size}{product.unit}</p>
      {product.category_name && <p className="text-[#5E7090] text-[10px] font-mono">{product.category_name}</p>}
      <div className="flex items-center justify-between mt-2 gap-2">
        <span className="text-[#D4AF37] font-mono font-extrabold text-sm">₺{product.price.toFixed(2)}</span>
        <div className="flex gap-1.5">
          {product.has_video && (
            <button
              onClick={openDetail}
              disabled={loadingVideo}
              className="rounded-lg px-2.5 py-1 text-[10px] font-bold border border-[#2A3650] text-[#5E7090] hover:text-[#D4AF37] hover:border-[#D4AF37]/40"
            >
              {loadingVideo ? '…' : 'Detay'}
            </button>
          )}
          <button
            onClick={() => onAdd(product)}
            className="rounded-lg px-3 py-1 text-xs font-extrabold"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000' }}
          >
            +
          </button>
        </div>
      </div>
      {videoUrl && (
        <VideoPopupModal videoUrl={videoUrl} title={product.name} onClose={() => setVideoUrl(null)} />
      )}
    </div>
  );
}

function CartAndCheckout({
  storeId,
  cart,
  setCart,
  onOrdered,
}: {
  storeId: string;
  cart: CartLine[];
  setCart: (c: CartLine[]) => void;
  onOrdered: () => void;
}) {
  const { user } = useAuth();
  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card_pos'>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = cart.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const checkout = async () => {
    if (!user) {
      setError('Sipariş vermek için giriş yapmalısınız.');
      return;
    }
    if (!address) {
      setError('Teslimat adresi gerekli.');
      return;
    }
    if (cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await placeOrder({
        storeId,
        customerId: user.id,
        items: cart,
        paymentMethod,
        deliveryAddress: address,
        placedFromLive: true,
      });
      setCart([]);
      onOrdered();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl p-4 space-y-3" style={CARD}>
      <p className="text-white font-extrabold text-sm">Sepetim ({cart.length})</p>
      {cart.length === 0 ? (
        <p className="text-[#5E7090] text-xs font-mono">Sepet boş.</p>
      ) : (
        <>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {cart.map((i) => (
              <div key={i.store_product_id} className="flex items-center justify-between text-xs">
                <span className="text-[#A3B3D1]">{i.product_name} × {i.quantity}</span>
                <span className="text-white font-mono">₺{(i.unit_price * i.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-[#2A3650] pt-2">
            <span className="text-[#5E7090] text-xs font-mono">Toplam</span>
            <span className="text-[#D4AF37] font-mono font-extrabold">₺{total.toFixed(2)}</span>
          </div>
          <input
            placeholder="Teslimat adresi"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full bg-black/30 border border-[#2A3650] rounded-lg px-3 py-2 text-sm text-white"
          />
          <div className="flex gap-2">
            {(['cash', 'card_pos'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className="flex-1 rounded-lg py-2 text-xs font-bold"
                style={{
                  background: paymentMethod === m ? '#D4AF3720' : 'transparent',
                  border: `1px solid ${paymentMethod === m ? '#D4AF37' : '#2A3650'}`,
                  color: paymentMethod === m ? '#D4AF37' : '#5E7090',
                }}
              >
                {m === 'cash' ? '💵 Nakit' : '💳 Kart (POS)'}
              </button>
            ))}
          </div>
          {error && <p className="text-red-400 text-[11px] font-mono">{error}</p>}
          <button
            onClick={checkout}
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-xs font-extrabold"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? '…' : 'Siparişi Tamamla'}
          </button>
          <p className="text-[10px] text-[#5E7090] font-mono text-center">Ödeme kapıda alınır.</p>
        </>
      )}
    </div>
  );
}

export default function CustomerHome() {
  const { user } = useAuth();
  const [selectedStore, setSelectedStore] = useState<NearbyStore | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [myOrders, setMyOrders] = useState<any[]>([]);

  const loadProducts = useCallback(async (storeId: string, categoryId?: string) => {
    const p = await getStoreProducts(storeId, categoryId);
    setProducts(p);
  }, []);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (selectedStore) loadProducts(selectedStore.store_id, activeCategory ?? undefined);
  }, [selectedStore, activeCategory, loadProducts]);

  const refreshOrders = useCallback(async () => {
    if (!user) return;
    const o = await getMyOrders(user.id);
    setMyOrders(o);
  }, [user]);

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  const addToCart = (p: StoreProduct) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.store_product_id === p.id);
      if (existing) {
        return prev.map((i) => (i.store_product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { store_product_id: p.id, product_name: p.name, unit_price: p.price, quantity: 1 }];
    });
  };

  if (!selectedStore) return <StoreSelector onSelect={setSelectedStore} />;

  return (
    <div className="space-y-5">
      <button onClick={() => setSelectedStore(null)} className="text-[#5E7090] text-xs font-mono">
        ← Mağaza değiştir
      </button>
      <h2 className="text-white font-black text-xl">{selectedStore.name}</h2>

      <div className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-5">
        <StoreLiveViewer
          storeId={selectedStore.store_id}
          storeName={selectedStore.name}
          initialIsLive={selectedStore.is_live}
        />
        <LiveStream storeId={selectedStore.store_id} storeName={selectedStore.name} />
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5">
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-white font-extrabold text-sm">Ürünler</p>
          </div>
          {categories.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
              <button
                onClick={() => setActiveCategory(null)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
                style={{ background: activeCategory === null ? '#D4AF37' : '#090d16', color: activeCategory === null ? '#000' : '#5E7090', border: '1px solid #2A3650' }}
              >
                Tümü
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.id)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
                  style={{ background: activeCategory === c.id ? '#D4AF37' : '#090d16', color: activeCategory === c.id ? '#000' : '#5E7090', border: '1px solid #2A3650' }}
                >
                  {c.icon ? `${c.icon} ` : ''}{c.name}
                </button>
              ))}
            </div>
          )}
          {products.length === 0 ? (
            <p className="text-[#5E7090] text-xs font-mono">Bu mağazada henüz ürün yok.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} onAdd={addToCart} />
              ))}
            </div>
          )}
        </div>
        <CartAndCheckout
          storeId={selectedStore.store_id}
          cart={cart}
          setCart={setCart}
          onOrdered={refreshOrders}
        />
      </div>

      <StoreAuctionsSection storeId={selectedStore.store_id} />

      {myOrders.length > 0 && (
        <div className="rounded-2xl p-5" style={CARD}>
          <p className="text-white font-extrabold text-sm mb-3">Siparişlerim</p>
          <div className="space-y-2">
            {myOrders.slice(0, 10).map((o) => (
              <div key={o.id} className="flex items-center justify-between text-xs">
                <span className="text-[#A3B3D1] font-mono">₺{Number(o.total_amount).toFixed(2)}</span>
                <span className="text-[#D4AF37] font-mono">{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
