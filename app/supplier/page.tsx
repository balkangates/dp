'use client';
// app/supplier/page.tsx — modules/supplier.js'in (dashboard.html üzerinden
// çalışan vanilla JS tedarikçi paneli) Next.js/React'e taşınmış hâli.
// Faz 1b — bkz. DampingVar-Sistem-Plani-NextJS.md §3.2/§3.3.
//
// 7 sekme: Gelen Talepler (ters ihale teklif ekranı) / Tekliflerim /
// Sevkiyat Durumu / Stok Yönetimi / Yeni Ürün Öner / Reddedilenler /
// Eksik Siparişler. middleware.ts zaten sunucu tarafında /supplier
// rotasını supplier/admin rolleriyle sınırlıyor.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchOpenAuctions, fetchMyBids, fetchMyShipments, fetchMyCatalogProducts,
  fetchSectors, fetchCategories, fetchSubcategories, fetchMyShortfalls,
  addVariant, updateVariantStock, proposeNewProduct, resubmitPrice, resolveShortfall,
  submitBid, fetchSupplierStats, fmtDate, statusTagStyle,
  type ReverseAuction, type SupplierBid, type SupplierShipment, type SupplierCatalogProduct,
  type Sector, type SupplierCategory, type Subcategory, type Shortfall, type SupplierStats,
} from '@/lib/supplier';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };
const INPUT = { background: '#0B1220', border: '1px solid #2A3650' };

type TabId = 'auctions' | 'bids' | 'shipments' | 'stock' | 'propose' | 'rejected' | 'shortfalls';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'auctions', label: 'Gelen Talepler', icon: 'fa-bullhorn' },
  { id: 'bids', label: 'Tekliflerim', icon: 'fa-hand-holding-dollar' },
  { id: 'shipments', label: 'Sevkiyat Durumu', icon: 'fa-truck-fast' },
  { id: 'stock', label: 'Stok Yönetimi', icon: 'fa-warehouse' },
  { id: 'propose', label: 'Yeni Ürün Öner', icon: 'fa-plus' },
  { id: 'rejected', label: 'Reddedilenler', icon: 'fa-rotate-left' },
  { id: 'shortfalls', label: 'Eksik Siparişler', icon: 'fa-triangle-exclamation' },
];

function StatusTag({ status }: { status: string }) {
  const { bg, fg } = statusTagStyle(status);
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: bg, color: fg }}>
      {status}
    </span>
  );
}

export default function SupplierPage() {
  const { profile, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('auctions');

  const [myCatalogProducts, setMyCatalogProducts] = useState<SupplierCatalogProduct[]>([]);
  const [categories, setCategories] = useState<SupplierCategory[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [stats, setStats] = useState<SupplierStats>({ totalProducts: 0, approved: 0, pending: 0, incomingOrders: 0, revenue: 0 });

  const [auctions, setAuctions] = useState<ReverseAuction[]>([]);
  const [bids, setBids] = useState<SupplierBid[]>([]);
  const [shipments, setShipments] = useState<SupplierShipment[]>([]);
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);

  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const myId = profile?.id ?? '';

  const reloadCatalog = useCallback(async () => {
    if (!myId) return;
    const cp = await fetchMyCatalogProducts(myId);
    setMyCatalogProducts(cp);
    setStats(await fetchSupplierStats(cp));
    return cp;
  }, [myId]);

  // İlk yükleme — kimliğe bağlı sabit veriler.
  useEffect(() => {
    if (!myId) return;
    (async () => {
      setLoading(true);
      const [cp, cats, secs, subs] = await Promise.all([
        fetchMyCatalogProducts(myId), fetchCategories(), fetchSectors(), fetchSubcategories(),
      ]);
      setMyCatalogProducts(cp);
      setCategories(cats);
      setSectors(secs);
      setSubcategories(subs);
      setStats(await fetchSupplierStats(cp));
      setLoading(false);
    })();
  }, [myId]);

  // Sekmeye özel veri — dashboard.html'deki davranışla birebir aynı (sekme
  // değiştirince yeniden fetch).
  useEffect(() => {
    if (!myId || loading) return;
    (async () => {
      setTabLoading(true);
      try {
        if (activeTab === 'auctions') setAuctions(await fetchOpenAuctions(myCatalogProducts));
        else if (activeTab === 'bids') setBids(await fetchMyBids(myId));
        else if (activeTab === 'shipments') setShipments(await fetchMyShipments(myId));
        else if (activeTab === 'shortfalls') setShortfalls(await fetchMyShortfalls(myId));
      } finally {
        setTabLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [activeTab, myId, loading]);

  const rejectedProducts = useMemo(() => myCatalogProducts.filter((p) => p.status === 'rejected'), [myCatalogProducts]);

  if (authLoading) return <main className="max-w-5xl mx-auto px-4 py-8 text-[#5E7090] font-mono text-sm">Yükleniyor…</main>;
  if (profile && profile.role !== 'supplier' && profile.role !== 'admin') {
    return <main className="max-w-5xl mx-auto px-4 py-8 text-red-400 font-mono text-sm">Bu sayfaya erişim yetkiniz yok.</main>;
  }

  const handleBid = async (auction: ReverseAuction) => {
    const priceStr = prompt(`Birim fiyat teklifiniz (tavan: ₺${auction.ceiling_price}):`);
    if (priceStr === null) return;
    const num = Number(priceStr);
    if (!num || num <= 0) return alert('Geçerli bir fiyat girin.');
    if (num > auction.ceiling_price) return alert('Teklif tavan fiyatın üzerinde olamaz.');
    const notes = prompt('Not (opsiyonel):') || '';
    setBusyId(auction.id);
    try {
      await submitBid(auction.id, myId, num, notes);
      setActiveTab('bids');
    } catch (e) {
      alert('Teklif gönderilemedi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <p className="text-white font-black text-xl">Tedarikçi Paneli</p>

      <StatsBar stats={stats} />

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
            style={{
              background: activeTab === t.id ? '#D4AF37' : '#090d16',
              color: activeTab === t.id ? '#000' : '#5E7090',
              border: '1px solid #2A3650',
            }}
          >
            <i className={`fas ${t.icon} mr-1`} />{t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl p-3" style={CARD}>
        {loading || tabLoading ? (
          <div className="text-center py-8 text-[#5E7090]"><i className="fas fa-spinner fa-spin" /></div>
        ) : activeTab === 'auctions' ? (
          <AuctionsTab auctions={auctions} busyId={busyId} onBid={handleBid} />
        ) : activeTab === 'bids' ? (
          <BidsTab bids={bids} />
        ) : activeTab === 'shipments' ? (
          <ShipmentsTab shipments={shipments} />
        ) : activeTab === 'stock' ? (
          <StockTab
            products={myCatalogProducts}
            busyId={busyId}
            setBusyId={setBusyId}
            reload={reloadCatalog}
          />
        ) : activeTab === 'propose' ? (
          <ProposeTab
            sectors={sectors}
            categories={categories}
            subcategories={subcategories}
            supplierId={myId}
            reload={async () => { await reloadCatalog(); setActiveTab('stock'); }}
          />
        ) : activeTab === 'rejected' ? (
          <RejectedTab
            products={rejectedProducts}
            supplierId={myId}
            busyId={busyId}
            setBusyId={setBusyId}
            reload={async () => { await reloadCatalog(); setActiveTab('stock'); }}
          />
        ) : (
          <ShortfallsTab shortfalls={shortfalls} busyId={busyId} setBusyId={setBusyId} reload={async () => setShortfalls(await fetchMyShortfalls(myId))} />
        )}
      </div>
    </main>
  );
}

// ═══ MODÜL 9 — Özet İstatistikler ═════════════════════════════════════════
function StatsBar({ stats }: { stats: SupplierStats }) {
  const items = [
    { label: 'TOPLAM ÜRÜN', value: String(stats.totalProducts), icon: 'fa-boxes', color: '#38BDF8' },
    { label: 'ONAYLI', value: String(stats.approved), icon: 'fa-circle-check', color: '#10B981' },
    { label: 'ONAY BEKLEYEN', value: String(stats.pending), icon: 'fa-hourglass-half', color: '#F59E0B' },
    { label: 'GELEN SİPARİŞ / CİRO', value: `${stats.incomingOrders} / ₺${stats.revenue.toLocaleString('tr-TR')}`, icon: 'fa-sack-dollar', color: '#D4AF37' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl p-3 flex items-center gap-2.5" style={CARD}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${it.color}20`, color: it.color }}>
            <i className={`fas ${it.icon}`} />
          </div>
          <div>
            <div className="text-[9px] text-[#5E7090] font-bold">{it.label}</div>
            <div className="text-white text-sm font-black">{it.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══ Gelen Talepler (ters ihale) ═══════════════════════════════════════
function AuctionsTab({ auctions, busyId, onBid }: { auctions: ReverseAuction[]; busyId: string | null; onBid: (a: ReverseAuction) => void }) {
  if (auctions.length === 0) return <div className="text-[#5E7090] text-xs py-5">Şu anda açık talep yok.</div>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
          <th className="p-2.5">Ürün</th><th className="p-2.5">Toplam Miktar</th><th className="p-2.5">Tavan Fiyat</th><th className="p-2.5">Bitiş</th><th className="p-2.5">İşlem</th>
        </tr>
      </thead>
      <tbody>
        {auctions.map((a) => (
          <tr key={a.id} className="border-b border-[#1E2A42]">
            <td className="p-2.5 text-white">{a.product_name}</td>
            <td className="p-2.5 text-[#A3B3D1]">{a.total_quantity} {a.quantity_unit}</td>
            <td className="p-2.5 text-[#A3B3D1] font-mono">₺{Number(a.ceiling_price).toLocaleString('tr-TR')}</td>
            <td className="p-2.5 text-[#5E7090] font-mono" style={{ fontSize: 11 }}>{fmtDate(a.end_time)}</td>
            <td className="p-2.5">
              <button
                onClick={() => onBid(a)}
                disabled={busyId === a.id}
                className="px-2 py-1 rounded text-[10px] font-bold"
                style={{ background: '#D4AF37', color: '#000' }}
              >
                <i className="fas fa-hand-holding-dollar mr-1" />Teklif Ver
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══ Tekliflerim ═══════════════════════════════════════════════════════
function BidsTab({ bids }: { bids: SupplierBid[] }) {
  if (bids.length === 0) return <div className="text-[#5E7090] text-xs py-5">Henüz teklif vermediniz.</div>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
          <th className="p-2.5">Ürün</th><th className="p-2.5">Teklifim</th><th className="p-2.5">Tavan Fiyat</th><th className="p-2.5">Durum</th><th className="p-2.5">Tarih</th>
        </tr>
      </thead>
      <tbody>
        {bids.map((b) => (
          <tr key={b.id} className="border-b border-[#1E2A42]">
            <td className="p-2.5 text-white">{b.reverse_auctions?.product_name || '—'}</td>
            <td className="p-2.5 text-[#A3B3D1] font-mono">₺{Number(b.unit_price).toLocaleString('tr-TR')}</td>
            <td className="p-2.5 text-[#5E7090] font-mono">{b.reverse_auctions?.ceiling_price ? `₺${Number(b.reverse_auctions.ceiling_price).toLocaleString('tr-TR')}` : '—'}</td>
            <td className="p-2.5"><StatusTag status={b.status} /></td>
            <td className="p-2.5 text-[#5E7090] font-mono" style={{ fontSize: 11 }}>{fmtDate(b.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══ Sevkiyat Durumu ═══════════════════════════════════════════════════
function ShipmentsTab({ shipments }: { shipments: SupplierShipment[] }) {
  if (shipments.length === 0) return <div className="text-[#5E7090] text-xs py-5">Aktif sevkiyatınız yok.</div>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
          <th className="p-2.5">Ürün</th><th className="p-2.5">Durum</th><th className="p-2.5">Not</th><th className="p-2.5">Güncelleme</th>
        </tr>
      </thead>
      <tbody>
        {shipments.map((s) => (
          <tr key={s.id} className="border-b border-[#1E2A42]">
            <td className="p-2.5 text-white">{s.reverse_auctions?.product_name || '—'}</td>
            <td className="p-2.5"><StatusTag status={s.status} /></td>
            <td className="p-2.5 text-[#5E7090]" style={{ fontSize: 11 }}>{s.tracking_note || '—'}</td>
            <td className="p-2.5 text-[#5E7090] font-mono" style={{ fontSize: 11 }}>{fmtDate(s.updated_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══ MODÜL 3.6 — Stok Yönetimi ═════════════════════════════════════════
function StockTab({
  products, busyId, setBusyId, reload,
}: {
  products: SupplierCatalogProduct[];
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  reload: () => Promise<unknown>;
}) {
  const [stockInputs, setStockInputs] = useState<Record<string, number>>({});

  if (products.length === 0) {
    return (
      <div className="text-[#5E7090] text-xs py-5">
        Henüz onaylı bir ürününüz yok. &quot;Yeni Ürün Öner&quot; sekmesinden admin onayına ürün gönderebilirsiniz.
      </div>
    );
  }

  const handleAddVariant = async (catalogProductId: string) => {
    const color = prompt('Renk (opsiyonel):') || '';
    const size = prompt('Beden (opsiyonel):') || '';
    const model = prompt('Model (opsiyonel):') || '';
    if (!color && !size && !model) return alert('En az bir varyant özelliği (renk/beden/model) girmelisiniz.');
    const qty = Number(prompt('Stok adedi:', '0') || 0);
    setBusyId(catalogProductId);
    try {
      await addVariant(catalogProductId, color, size, model, qty);
      await reload();
    } catch (e) {
      alert('Varyant eklenemedi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveStock = async (variantId: string) => {
    const qty = stockInputs[variantId];
    if (qty === undefined) return;
    setBusyId(variantId);
    try {
      await updateVariantStock(variantId, qty);
      await reload();
    } catch (e) {
      alert('Stok güncellenemedi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3.5">
      {products.map((cp) => {
        const totalStock = (cp.product_variants || []).reduce((s, v) => s + Number(v.stock_qty || 0), 0);
        return (
          <div key={cp.id} className="rounded-xl p-3" style={CARD}>
            <div className="flex justify-between items-center mb-2.5">
              <div className="font-extrabold text-white text-sm">
                {cp.name}{' '}
                {!cp.is_approved && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold ml-1" style={{ background: '#F59E0B20', color: '#F59E0B' }}>
                    Onay Bekliyor
                  </span>
                )}
              </div>
              <span
                className="px-2 py-0.5 rounded text-[10px] font-bold"
                style={{ background: totalStock > 0 ? '#10B98120' : '#EF444420', color: totalStock > 0 ? '#10B981' : '#EF4444' }}
              >
                <i className={`fas ${totalStock > 0 ? 'fa-circle-check' : 'fa-circle-xmark'} mr-1`} />Toplam Stok: {totalStock}
              </span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
                  <th className="p-1.5">Renk</th><th className="p-1.5">Beden</th><th className="p-1.5">Model</th><th className="p-1.5">Stok</th><th className="p-1.5" />
                </tr>
              </thead>
              <tbody>
                {(cp.product_variants || []).length === 0 ? (
                  <tr><td colSpan={5} className="p-2 text-[#5E7090]" style={{ fontSize: 11 }}>Varyant tanımlanmamış.</td></tr>
                ) : (
                  cp.product_variants.map((v) => (
                    <tr key={v.id} className="border-b border-[#1E2A42]">
                      <td className="p-1.5 text-[#A3B3D1]">{v.color || '—'}</td>
                      <td className="p-1.5 text-[#A3B3D1]">{v.size || '—'}</td>
                      <td className="p-1.5 text-[#A3B3D1]">{v.model || '—'}</td>
                      <td className="p-1.5">
                        <input
                          type="number" min={0}
                          defaultValue={v.stock_qty}
                          onChange={(e) => setStockInputs((prev) => ({ ...prev, [v.id]: Number(e.target.value) }))}
                          className="w-[70px] rounded px-2 py-1 text-white"
                          style={INPUT}
                        />
                      </td>
                      <td className="p-1.5">
                        <button
                          onClick={() => handleSaveStock(v.id)}
                          disabled={busyId === v.id}
                          className="w-6 h-6 rounded"
                          style={{ border: '1px solid #2A3650', color: '#5E7090' }}
                        >
                          <i className="fas fa-check text-[10px]" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <button
              onClick={() => handleAddVariant(cp.id)}
              disabled={busyId === cp.id}
              className="mt-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold"
              style={{ border: '1px solid #2A3650', color: '#5E7090' }}
            >
              <i className="fas fa-plus mr-1" />Varyant Ekle
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ═══ MODÜL 3.6 — Yeni Ürün Öner ═══════════════════════════════════════
function ProposeTab({
  sectors, categories, subcategories, supplierId, reload,
}: {
  sectors: Sector[];
  categories: SupplierCategory[];
  subcategories: Subcategory[];
  supplierId: string;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const categoryOptions = categories.filter((c) => c.sector_id === sectorId);
  const subcategoryOptions = subcategories.filter((s) => s.category_id === categoryId);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const suggestedPrice = Number(price);
    if (!trimmedName) return alert('Ürün adı gerekli.');
    if (!categoryId) return alert('Sektör ve kategori seçin.');
    if (!suggestedPrice || suggestedPrice <= 0) return alert('Geçerli bir fiyat girin.');
    setSubmitting(true);
    try {
      await proposeNewProduct(supplierId, {
        name: trimmedName, category_id: categoryId, subcategory_id: subcategoryId || null, suggested_price: suggestedPrice,
      });
      alert('Ürün öneriniz admin onayına gönderildi.');
      setName(''); setSectorId(''); setCategoryId(''); setSubcategoryId(''); setPrice('');
      await reload();
    } catch (e) {
      alert('Ürün önerisi gönderilemedi: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md space-y-2">
      <p className="text-[#5E7090] text-xs mb-2">Önerdiğiniz ürün admin onayından geçmeden kataloğa görünmez ve satılamaz.</p>

      <label className="text-[11px] text-[#A3B3D1] block">Ürün Adı</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg px-3 py-2 text-white text-sm" style={INPUT} />

      <label className="text-[11px] text-[#A3B3D1] block">Sektör</label>
      <select
        value={sectorId}
        onChange={(e) => { setSectorId(e.target.value); setCategoryId(''); setSubcategoryId(''); }}
        className="w-full rounded-lg px-3 py-2 text-white text-sm"
        style={INPUT}
      >
        <option value="">Sektör seçin…</option>
        {sectors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>

      <label className="text-[11px] text-[#A3B3D1] block">Kategori</label>
      <select
        value={categoryId}
        onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}
        disabled={!sectorId}
        className="w-full rounded-lg px-3 py-2 text-white text-sm"
        style={INPUT}
      >
        <option value="">{sectorId ? 'Kategori seçin…' : 'Önce sektör seçin…'}</option>
        {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <label className="text-[11px] text-[#A3B3D1] block">Alt Kategori</label>
      <select
        value={subcategoryId}
        onChange={(e) => setSubcategoryId(e.target.value)}
        disabled={!categoryId}
        className="w-full rounded-lg px-3 py-2 text-white text-sm"
        style={INPUT}
      >
        <option value="">{categoryId ? 'Alt kategori seçin (opsiyonel)' : 'Önce kategori seçin…'}</option>
        {subcategoryOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <label className="text-[11px] text-[#A3B3D1] block">Teklif Fiyatı (₺)</label>
      <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-lg px-3 py-2 text-white text-sm" style={INPUT} />

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-2.5 rounded-lg text-sm font-bold mt-1"
        style={{ background: '#D4AF37', color: '#000' }}
      >
        <i className="fas fa-paper-plane mr-1.5" />Onaya Gönder
      </button>
    </div>
  );
}

// ═══ v12 — Reddedilenler (yeniden fiyat gönderme) ═══════════════════════
function RejectedTab({
  products, supplierId, busyId, setBusyId, reload,
}: {
  products: SupplierCatalogProduct[];
  supplierId: string;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  reload: () => Promise<void>;
}) {
  const [prices, setPrices] = useState<Record<string, number>>({});

  if (products.length === 0) return <div className="text-[#5E7090] text-xs py-5">Reddedilen ürününüz yok.</div>;

  const handleResubmit = async (p: SupplierCatalogProduct) => {
    const newPrice = prices[p.id];
    if (!newPrice || newPrice <= 0) return alert('Geçerli bir yeni fiyat girin.');
    setBusyId(p.id);
    try {
      await resubmitPrice(p.id, newPrice, supplierId);
      await reload();
    } catch (e) {
      alert('Fiyat gönderilemedi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
          <th className="p-2.5">Ürün</th><th className="p-2.5">Önceki Fiyat</th><th className="p-2.5">Red Sebebi</th><th className="p-2.5">Yeni Fiyat</th><th className="p-2.5" />
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.id} className="border-b border-[#1E2A42]">
            <td className="p-2.5 text-white">{p.name}</td>
            <td className="p-2.5 text-[#5E7090] font-mono">₺{Number(p.suggested_price || 0).toLocaleString('tr-TR')}</td>
            <td className="p-2.5" style={{ color: '#EF4444', fontSize: 11 }}>{p.rejection_reason || '—'}</td>
            <td className="p-2.5">
              <input
                type="number" min={0} step={0.01} placeholder="Yeni fiyat"
                onChange={(e) => setPrices((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))}
                className="w-28 rounded px-2 py-1 text-white"
                style={INPUT}
              />
            </td>
            <td className="p-2.5">
              <button
                onClick={() => handleResubmit(p)}
                disabled={busyId === p.id}
                className="px-2 py-1 rounded text-[10px] font-bold"
                style={{ background: '#D4AF37', color: '#000' }}
              >
                <i className="fas fa-rotate-right mr-1" />Yeniden Gönder
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══ MODÜL 3.6 — Eksik Siparişler ═══════════════════════════════════════
function ShortfallsTab({
  shortfalls, busyId, setBusyId, reload,
}: {
  shortfalls: Shortfall[];
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  reload: () => Promise<void>;
}) {
  if (shortfalls.length === 0) return <div className="text-[#5E7090] text-xs py-5">Eksik siparişiniz yok.</div>;

  const handleResolve = async (id: string) => {
    if (!confirm('Bu eksik siparişi tamamladığınızı onaylıyor musunuz?')) return;
    setBusyId(id);
    try {
      await resolveShortfall(id);
      await reload();
    } catch (e) {
      alert('İşlem başarısız: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
          <th className="p-2.5">Ürün</th><th className="p-2.5">Eksik Adet</th><th className="p-2.5">Termin</th><th className="p-2.5">Ceza Puanı</th><th className="p-2.5">Durum</th><th className="p-2.5" />
        </tr>
      </thead>
      <tbody>
        {shortfalls.map((s) => {
          const overdue = new Date(s.deadline_at) < new Date() && s.status === 'open';
          return (
            <tr key={s.id} className="border-b border-[#1E2A42]">
              <td className="p-2.5 text-white">{s.catalog_products?.name || '—'}</td>
              <td className="p-2.5 text-[#A3B3D1]">{s.shortfall_qty}</td>
              <td className="p-2.5 font-mono" style={{ fontSize: 11, color: overdue ? '#EF4444' : '#A3B3D1' }}>{fmtDate(s.deadline_at)}</td>
              <td className="p-2.5" style={{ color: '#EF4444' }}>{s.penalty_points}</td>
              <td className="p-2.5"><StatusTag status={s.status} /></td>
              <td className="p-2.5">
                {s.status !== 'resolved' && (
                  <button
                    onClick={() => handleResolve(s.id)}
                    disabled={busyId === s.id}
                    className="px-2 py-1 rounded text-[10px] font-bold"
                    style={{ background: '#10B98120', color: '#10B981', border: '1px solid #10B98150' }}
                  >
                    <i className="fas fa-check mr-1" />Tamamladım
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
