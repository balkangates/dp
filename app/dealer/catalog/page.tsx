'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ensureStore } from '@/lib/dealer';
import {
  loadCategories, loadApprovedCatalog, loadMyStoreProducts, loadCategoryStatus,
  selectCatalogProduct, deselectStoreProduct, updateStock, addYoutubeLink, removeVideo,
  type Category, type CatalogProduct, type StoreProductRow,
} from '@/lib/dealer-catalog';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

export default function DealerCatalogPage() {
  const { profile } = useAuth();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [myProducts, setMyProducts] = useState<StoreProductRow[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [categoryStatus, setCategoryStatus] = useState<any[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [linkFormOpenId, setLinkFormOpenId] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async (sId: string) => {
    const [cats, cat, mine, status] = await Promise.all([
      loadCategories(), loadApprovedCatalog(), loadMyStoreProducts(sId), loadCategoryStatus(sId),
    ]);
    setCategories(cats);
    setCatalog(cat);
    setMyProducts(mine);
    setCategoryStatus(status);
    setActiveCategoryId((prev) => prev ?? cats[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const s = await ensureStore(profile.id);
      if (s) {
        setStoreId(s.id);
        await loadAll(s.id);
      }
      setLoading(false);
    })();
  }, [profile, loadAll]);

  const myProductFor = (catalogProductId: string) => myProducts.find((p) => p.catalog_product_id === catalogProductId);
  const statusFor = (categoryId: string) => categoryStatus.find((s) => s.category_id === categoryId);

  const handleSelect = async (cp: CatalogProduct) => {
    if (!storeId) return;
    setBusyId(cp.id);
    try {
      await selectCatalogProduct(storeId, cp);
      await loadAll(storeId);
    } catch (e) {
      alert('Ürün seçilemedi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeselect = async (storeProductId: string) => {
    if (!storeId) return;
    setBusyId(storeProductId);
    try {
      await deselectStoreProduct(storeProductId);
      await loadAll(storeId);
    } catch (e) {
      alert('Kaldırılamadı: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleStockChange = async (storeProductId: string, qty: number) => {
    try {
      await updateStock(storeProductId, Math.max(0, Math.floor(qty)));
      setMyProducts((prev) => prev.map((p) => (p.id === storeProductId ? { ...p, stock_qty: qty } : p)));
    } catch (e) {
      alert('Stok güncellenemedi: ' + (e as Error).message);
    }
  };

  const handleSaveLink = async (storeProductId: string) => {
    if (!storeId) return;
    try {
      await addYoutubeLink(storeProductId, linkInput);
      setLinkFormOpenId(null);
      setLinkInput('');
      await loadAll(storeId);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleRemoveVideo = async (videoId: string) => {
    if (!storeId) return;
    if (!confirm('Bu YouTube linkini kaldırmak istediğinize emin misiniz? Başka video eklemezseniz ürün canlıda gösterilemez.')) return;
    try {
      await removeVideo(videoId);
      await loadAll(storeId);
    } catch (e) {
      alert('Kaldırılamadı: ' + (e as Error).message);
    }
  };

  if (loading) return <p className="text-[#5E7090] font-mono text-sm">Yükleniyor…</p>;
  if (!storeId) return <p className="text-[#5E7090] font-mono text-sm">Önce Canlı Satış sayfasından mağazanızı oluşturun.</p>;

  const categoryCatalog = catalog.filter((c) => c.category_id === activeCategoryId);
  const activeStatus = activeCategoryId ? statusFor(activeCategoryId) : null;

  return (
    <div className="space-y-4">
      <p className="text-white font-black text-lg">Ürün Seçimi (Onaylı Katalog)</p>
      <div className="rounded-xl p-3 text-[11px] text-[#A3B3D1]" style={CARD}>
        Ürünleri kendiniz oluşturamazsınız — yalnızca onaylı tedarikçi kataloğundan seçebilirsiniz. Her kategoride
        ürünlerin en az <b style={{ color: '#D4AF37' }}>%20&apos;sini</b> seçmeniz gerekir. Seçtiğiniz her ürün için
        kendi YouTube kanalınızda paylaştığınız bir tanıtım videosunun <b style={{ color: '#D4AF37' }}>linkini</b> ve{' '}
        <b style={{ color: '#D4AF37' }}>Stok</b> adedini 0&apos;ın üzerine girmelisiniz — yoksa ürün canlıda/mağaza
        sayfanızda gösterilemez ve satılamaz.
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {categories.map((c) => {
          const s = statusFor(c.id);
          return (
            <button
              key={c.id}
              onClick={() => setActiveCategoryId(c.id)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
              style={{
                background: activeCategoryId === c.id ? '#D4AF37' : '#090d16',
                color: activeCategoryId === c.id ? '#000' : '#5E7090',
                border: '1px solid #2A3650',
              }}
            >
              {c.name} {s ? `(%${Math.round(s.selection_pct ?? 0)})` : ''}
            </button>
          );
        })}
      </div>

      {activeStatus && (
        <div className="rounded-xl p-3 text-xs" style={CARD}>
          Seçim oranı: %{Math.round(activeStatus.selection_pct ?? 0)} / %20 gerekli —{' '}
          {activeStatus.is_active ? (
            <span style={{ color: '#10B981' }}>Kategori aktif.</span>
          ) : (
            <span style={{ color: '#EF4444' }}>Kategori pasif, daha fazla ürün seçin.</span>
          )}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={CARD}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
              <th className="p-2.5">Ürün</th>
              <th className="p-2.5">Önerilen Fiyat</th>
              <th className="p-2.5">Seçim</th>
              <th className="p-2.5">Stok</th>
              <th className="p-2.5">Tanıtım Videosu (YouTube)</th>
            </tr>
          </thead>
          <tbody>
            {categoryCatalog.map((cp) => {
              const mine = myProductFor(cp.id);
              return (
                <tr key={cp.id} className="border-b border-[#1E2A42]">
                  <td className="p-2.5 text-white">{cp.name}</td>
                  <td className="p-2.5 text-[#A3B3D1] font-mono">₺{cp.suggested_price ?? '—'}</td>
                  <td className="p-2.5">
                    {mine ? (
                      <button
                        onClick={() => handleDeselect(mine.id)}
                        disabled={busyId === mine.id}
                        className="px-2 py-1 rounded text-[10px] font-bold"
                        style={{ background: '#EF444420', color: '#EF4444', border: '1px solid #EF444450' }}
                      >
                        <i className="fas fa-xmark mr-1" />Kaldır
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSelect(cp)}
                        disabled={busyId === cp.id}
                        className="px-2 py-1 rounded text-[10px] font-bold"
                        style={{ background: '#D4AF37', color: '#000' }}
                      >
                        <i className="fas fa-plus mr-1" />Seç
                      </button>
                    )}
                  </td>
                  <td className="p-2.5">
                    {mine ? (
                      <div>
                        <input
                          type="number"
                          min={0}
                          defaultValue={Number(mine.stock_qty || 0)}
                          onBlur={(e) => handleStockChange(mine.id, Number(e.target.value))}
                          className="w-20 rounded px-2 py-1 text-white text-xs"
                          style={{ background: '#0B1220', border: `1px solid ${Number(mine.stock_qty || 0) > 0 ? '#2A3650' : '#EF4444'}` }}
                        />
                        {Number(mine.stock_qty || 0) <= 0 && (
                          <div className="text-[9px] text-red-400 mt-0.5">Stok 0 — müşteriye görünmez!</div>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="p-2.5">
                    {!mine ? '—' : mine.has_video ? (
                      <div className="flex items-center gap-2">
                        <a
                          href={mine.product_videos?.[mine.product_videos.length - 1]?.video_url ?? '#'}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[10px] px-2 py-1 rounded"
                          style={{ background: '#10B98120', color: '#10B981' }}
                        >
                          <i className="fab fa-youtube mr-1" />Linki Görüntüle
                        </a>
                        {mine.product_videos?.[mine.product_videos.length - 1] && (
                          <button
                            onClick={() => handleRemoveVideo(mine.product_videos[mine.product_videos.length - 1].id)}
                            className="text-[#5E7090] hover:text-red-400"
                          >
                            <i className="fas fa-trash" />
                          </button>
                        )}
                      </div>
                    ) : linkFormOpenId === mine.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          type="url"
                          value={linkInput}
                          onChange={(e) => setLinkInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLink(mine.id); if (e.key === 'Escape') setLinkFormOpenId(null); }}
                          placeholder="https://youtube.com/watch?v=..."
                          className="w-44 rounded px-2 py-1 text-xs text-white"
                          style={{ background: '#0B1220', border: '1px solid #2A3650' }}
                        />
                        <button onClick={() => handleSaveLink(mine.id)} className="w-6 h-6 rounded" style={{ background: '#10B981' }}>
                          <i className="fas fa-check text-white text-[10px]" />
                        </button>
                        <button onClick={() => setLinkFormOpenId(null)} className="w-6 h-6 rounded" style={{ background: '#2A3650' }}>
                          <i className="fas fa-xmark text-white text-[10px]" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setLinkFormOpenId(mine.id); setLinkInput(''); }}
                        className="text-[10px] px-2 py-1 rounded"
                        style={{ border: '1px solid #2A3650', color: '#5E7090' }}
                      >
                        <i className="fab fa-youtube mr-1" />YouTube Linki Ekle
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {categoryCatalog.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-[#5E7090]">Bu kategoride onaylı ürün yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
