'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { getStoreById, type NearbyStore } from '@/lib/geo';
import {
  getStoreProducts, getMyOrders, getCategories, getSectors, getSubcategories,
  ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, type StoreProduct, type CartLine, type Category, type Sector, type Subcategory,
} from '@/lib/dampingvar';
import StoreLiveViewer from '@/components/StoreLiveViewer';
import LiveStream from '@/components/LiveStream';
import StoreSocialBar from '@/components/StoreSocialBar';
import StoreShopOverlay from '@/components/StoreShopOverlay';
import StoreAuctionsSection from '@/components/StoreAuctionsSection';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

export default function StorePage() {
  const { storeId } = useParams<{ storeId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [store, setStore] = useState<NearbyStore | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [spotlightProductId, setSpotlightProductId] = useState<string | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [activeSector, setActiveSector] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [myOrders, setMyOrders] = useState<any[]>([]);

  useEffect(() => {
    getStoreById(storeId).then(setStore).finally(() => setStoreLoading(false));
  }, [storeId]);

  // FAZ 6 — yayıncı kontrolü: bayi hangi ürünü "öne çıkardıysa"
  // (stores.spotlight_product_id) müşteri tarafında GERÇEK ZAMANLI
  // yansısın diye realtime dinleniyor.
  useEffect(() => {
    supabase.from('stores').select('spotlight_product_id').eq('id', storeId).single()
      .then(({ data }) => setSpotlightProductId(data?.spotlight_product_id ?? null));

    const channel = supabase
      .channel(`store-spotlight-${storeId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stores', filter: `id=eq.${storeId}` },
        (payload) => setSpotlightProductId((payload.new as { spotlight_product_id?: string | null }).spotlight_product_id ?? null))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  const loadProducts = useCallback(async (sId: string, categoryId?: string, sectorId?: string, subcategoryId?: string) => {
    const p = await getStoreProducts(sId, categoryId, sectorId, subcategoryId);
    setProducts(p);
  }, []);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => setCategories([]));
    getSectors().then(setSectors).catch(() => setSectors([]));
    getSubcategories().then(setSubcategories).catch(() => setSubcategories([]));
  }, []);

  useEffect(() => {
    if (store) loadProducts(store.store_id, activeCategory ?? undefined, activeSector ?? undefined, activeSubcategory ?? undefined);
  }, [store, activeCategory, activeSector, activeSubcategory, loadProducts]);

  useEffect(() => {
    if (!activeSector) return;
    const stillValid = categories.some((c) => c.id === activeCategory && c.sector_id === activeSector);
    if (!stillValid) setActiveCategory(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSector]);

  // Kategori değişince, artık ait olmadığı bir alt kategori seçiliyse sıfırla.
  useEffect(() => {
    if (!activeCategory) { setActiveSubcategory(null); return; }
    const stillValid = subcategories.some((s) => s.id === activeSubcategory && s.category_id === activeCategory);
    if (!stillValid) setActiveSubcategory(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  const refreshOrders = useCallback(async () => {
    if (!user) return;
    const o = await getMyOrders(user.id);
    setMyOrders(o);
  }, [user]);

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  if (storeLoading) {
    return <main className="max-w-6xl mx-auto px-4 py-8 text-[#5E7090] font-mono text-sm">Mağaza yükleniyor…</main>;
  }
  if (!store) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <p className="text-[#5E7090] font-mono text-sm">Mağaza bulunamadı.</p>
        <button onClick={() => router.push('/')} className="text-[#D4AF37] text-xs font-mono mt-2">← Mağaza seçimine dön</button>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-5">
      <button onClick={() => router.push('/')} className="text-[#5E7090] text-xs font-mono">
        ← Mağaza değiştir
      </button>
      <h2 className="text-white font-black text-xl">{store.name}</h2>

      <div className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-5">
        <div className="relative flex flex-col">
          <StoreLiveViewer storeId={store.store_id} storeName={store.name} initialIsLive={store.is_live} />

          {/* TikTok tarzı alışveriş katmanı: sektör/kategori/alt kategori
              dropdown'ları, sepet + görüntülü görüş ikonları, video
              footer'ında yatay ürün şeridi — hepsi videonun üzerinde
              (lg+) ya da altında (mobil, in-flow). */}
          <StoreShopOverlay
            storeId={store.store_id}
            storeName={store.name}
            sectors={sectors}
            categories={categories}
            subcategories={subcategories}
            activeSector={activeSector}
            activeCategory={activeCategory}
            activeSubcategory={activeSubcategory}
            setActiveSector={setActiveSector}
            setActiveCategory={setActiveCategory}
            setActiveSubcategory={setActiveSubcategory}
            products={products}
            spotlightProductId={spotlightProductId}
            cart={cart}
            setCart={setCart}
            onOrdered={refreshOrders}
          />

          {/* TikTok tarzı beğeni/yorum/takip/paylaş çubuğu — mağaza bazlı. */}
          <StoreSocialBar storeId={store.store_id} storeName={store.name} />
        </div>
        <LiveStream storeId={store.store_id} storeName={store.name} />
      </div>

      <StoreAuctionsSection storeId={store.store_id} />

      {myOrders.length > 0 && (
        <div className="rounded-2xl p-5" style={CARD}>
          <p className="text-white font-extrabold text-sm mb-3">Siparişlerim</p>
          <div className="space-y-2.5">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {myOrders.slice(0, 10).map((o: any) => {
              const escrow = o.escrow_transactions?.[0];
              const invoice = o.store_order_invoices?.[0];
              const deliveryNote = o.delivery_notes?.[0];
              const shipment = o.store_order_shipments?.[0];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const items: any[] = o.store_order_items ?? [];
              return (
                <div key={o.id} className="rounded-lg p-3" style={{ background: '#0B1220', border: '1px solid #1E2A42' }}>
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="text-white font-bold">{o.stores?.name ?? ''}</span>
                      <span className="text-[#5E7090] font-mono ml-2 text-[10px]">
                        #{String(o.id).slice(0, 8)} · {new Date(o.created_at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <span className="text-[#D4AF37] font-mono font-bold">{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
                  </div>

                  {items.length > 0 && (
                    <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px dashed #2A3650' }}>
                      {items.map((it, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="text-[#A3B3D1]">{it.product_name} × {it.quantity}</span>
                          <span className="text-white font-mono">₺{Number(it.total_price).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2 pt-2 text-xs" style={{ borderTop: '1px dashed #2A3650' }}>
                    <span className="text-[#5E7090] font-mono">{PAYMENT_METHOD_LABEL[o.payment_method] ?? o.payment_method}</span>
                    <span className="text-[#D4AF37] font-mono font-extrabold">Toplam: ₺{Number(o.total_amount).toFixed(2)}</span>
                  </div>
                  {o.delivery_address && (
                    <p className="text-[10px] text-[#5E7090] font-mono mt-1">
                      <i className="fas fa-location-dot mr-1" />{o.delivery_address}
                    </p>
                  )}

                  {(escrow || invoice || deliveryNote || shipment) && (
                    <div className="flex gap-3 flex-wrap mt-1.5 text-[10px] text-[#5E7090] font-mono">
                      {escrow && (
                        <span>
                          <i className="fas fa-vault mr-1" />
                          Escrow: {escrow.status === 'HELD' ? 'Bekliyor' : escrow.status === 'RELEASED' ? 'Serbest bırakıldı' : 'İade edildi'}
                        </span>
                      )}
                      {invoice && <span><i className="fas fa-file-invoice mr-1" />Fatura: {invoice.invoice_number}</span>}
                      {deliveryNote && <span><i className="fas fa-truck mr-1" />İrsaliye: {deliveryNote.document_no}</span>}
                      {shipment?.tracking_number && (
                        <span><i className="fas fa-location-dot mr-1" />Takip No: {shipment.tracking_number}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
