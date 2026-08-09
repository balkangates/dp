'use client';
// app/admin/page.tsx — modules/catalog-admin.js'in (dashboard.html üzerinden
// çalışan vanilla JS admin paneli) Next.js/React'e taşınmış hâli.
// Faz 1b — bkz. DampingVar-Sistem-Plani-NextJS.md §3.
//
// 4 sekme: Katalog Onayı / Komisyon Oranları / Ürün Önerileri / Bayi Kazançları.
// Hiçbir hesaplama burada yapılmaz — hepsi DB fonksiyonlarının (ör.
// accept_product_suggestion) ince bir istemci katmanı; middleware.ts zaten
// sunucu tarafında /admin rotasını admin rolüyle sınırlıyor.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchPendingCatalog, fetchCategories, fetchPendingSuggestions, fetchCatalogForSelect,
  fetchEarnings, approveCatalog, rejectCatalog, rejectSuggestion, acceptSuggestion,
  markEarningPaid, updateCommissionRate, fmtMoney, monthLabel,
  type PendingCatalogProduct, type AdminCategory, type PendingSuggestion, type CatalogOption, type DealerEarning,
} from '@/lib/catalog-admin';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

type TabId = 'pending-catalog' | 'commission-rates' | 'suggestions' | 'earnings';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'pending-catalog', label: 'Katalog Onayı', icon: 'fa-clipboard-check' },
  { id: 'commission-rates', label: 'Komisyon Oranları', icon: 'fa-percent' },
  { id: 'suggestions', label: 'Ürün Önerileri', icon: 'fa-lightbulb' },
  { id: 'earnings', label: 'Bayi Kazançları', icon: 'fa-sack-dollar' },
];

const TAB_BTN = (active: boolean): React.CSSProperties => ({
  background: active ? '#D4AF37' : '#090d16',
  color: active ? '#000' : '#5E7090',
  border: '1px solid #2A3650',
});

export default function AdminPage() {
  const { profile, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('pending-catalog');

  const [pendingCatalog, setPendingCatalog] = useState<PendingCatalogProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [suggestions, setSuggestions] = useState<PendingSuggestion[]>([]);
  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [earnings, setEarnings] = useState<DealerEarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Her sekme kendi verisini taze çeker — dashboard.html'deki davranışla
  // birebir aynı (sekme değiştirince yeniden fetch).
  const loadTab = useCallback(async (tab: TabId) => {
    setLoading(true);
    try {
      if (tab === 'pending-catalog') setPendingCatalog(await fetchPendingCatalog());
      else if (tab === 'commission-rates') setCategories(await fetchCategories());
      else if (tab === 'suggestions') {
        const [s, c] = await Promise.all([fetchPendingSuggestions(), fetchCatalogForSelect()]);
        setSuggestions(s);
        setCatalogOptions(c);
      } else setEarnings(await fetchEarnings());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTab(activeTab);
  }, [activeTab, loadTab]);

  if (authLoading) return <main className="max-w-5xl mx-auto px-4 py-8 text-[#5E7090] font-mono text-sm">Yükleniyor…</main>;
  if (profile && profile.role !== 'admin') {
    return <main className="max-w-5xl mx-auto px-4 py-8 text-red-400 font-mono text-sm">Bu sayfaya erişim yetkiniz yok.</main>;
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <p className="text-white font-black text-xl">Tedarik & Komisyon Yönetimi</p>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
            style={TAB_BTN(activeTab === t.id)}
          >
            <i className={`fas ${t.icon} mr-1`} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl p-3" style={CARD}>
        {loading ? (
          <div className="text-center py-8 text-[#5E7090]"><i className="fas fa-spinner fa-spin" /></div>
        ) : activeTab === 'pending-catalog' ? (
          <PendingCatalogTab
            items={pendingCatalog}
            busyId={busyId}
            setBusyId={setBusyId}
            profileId={profile?.id ?? ''}
            reload={() => loadTab('pending-catalog')}
          />
        ) : activeTab === 'commission-rates' ? (
          <CommissionRatesTab categories={categories} busyId={busyId} setBusyId={setBusyId} />
        ) : activeTab === 'suggestions' ? (
          <SuggestionsTab
            suggestions={suggestions}
            catalogOptions={catalogOptions}
            busyId={busyId}
            setBusyId={setBusyId}
            reload={() => loadTab('suggestions')}
          />
        ) : (
          <EarningsTab earnings={earnings} busyId={busyId} setBusyId={setBusyId} reload={() => loadTab('earnings')} />
        )}
      </div>
    </main>
  );
}

// ═══ Katalog Onayı ═══════════════════════════════════════════════════════
function PendingCatalogTab({
  items, busyId, setBusyId, profileId, reload,
}: {
  items: PendingCatalogProduct[];
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  profileId: string;
  reload: () => void;
}) {
  const [prices, setPrices] = useState<Record<string, number>>({});

  if (items.length === 0) {
    return <div className="text-[#5E7090] text-xs py-5">Onay bekleyen ürün yok.</div>;
  }

  const priceFor = (p: PendingCatalogProduct) => prices[p.id] ?? p.suggested_price ?? 0;

  const handleApprove = async (p: PendingCatalogProduct) => {
    const price = priceFor(p);
    if (!price || price <= 0) return alert('Geçerli bir nihai satış fiyatı girin.');
    setBusyId(p.id);
    try {
      await approveCatalog(p.id, price, profileId);
      reload();
    } catch (e) {
      alert('Onaylanamadı: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Red sebebi (tedarikçi bu mesajı görecek):');
    if (reason === null) return;
    setBusyId(id);
    try {
      await rejectCatalog(id, reason, profileId);
      reload();
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
          <th className="p-2.5">Ürün</th>
          <th className="p-2.5">Kategori</th>
          <th className="p-2.5">Tedarikçi Teklifi</th>
          <th className="p-2.5">Nihai Satış Fiyatı</th>
          <th className="p-2.5">İşlem</th>
        </tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <tr key={p.id} className="border-b border-[#1E2A42]">
            <td className="p-2.5 text-white">{p.name}</td>
            <td className="p-2.5 text-[#A3B3D1]">{p.categories?.name || '—'}</td>
            <td className="p-2.5 text-[#5E7090] font-mono">{fmtMoney(p.suggested_price)}</td>
            <td className="p-2.5">
              <input
                type="number" min={0} step={0.01}
                defaultValue={p.suggested_price ?? 0}
                onChange={(e) => setPrices((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))}
                className="w-28 rounded px-2 py-1 text-white"
                style={{ background: '#0B1220', border: '1px solid #2A3650' }}
              />
            </td>
            <td className="p-2.5 space-x-1.5 whitespace-nowrap">
              <button
                onClick={() => handleApprove(p)}
                disabled={busyId === p.id}
                className="px-2 py-1 rounded text-[10px] font-bold"
                style={{ background: '#10B98120', color: '#10B981', border: '1px solid #10B98150' }}
              >
                <i className="fas fa-check mr-1" />Onayla
              </button>
              <button
                onClick={() => handleReject(p.id)}
                disabled={busyId === p.id}
                className="px-2 py-1 rounded text-[10px] font-bold"
                style={{ background: '#EF444420', color: '#EF4444', border: '1px solid #EF444450' }}
              >
                <i className="fas fa-xmark mr-1" />Reddet
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══ Komisyon Oranları ═══════════════════════════════════════════════════
function CommissionRatesTab({
  categories, busyId, setBusyId,
}: {
  categories: AdminCategory[];
  busyId: string | null;
  setBusyId: (id: string | null) => void;
}) {
  const [rates, setRates] = useState<Record<string, number>>({});
  const [savedId, setSavedId] = useState<string | null>(null);

  const handleSave = async (c: AdminCategory) => {
    const pct = rates[c.id] ?? c.commission_pct;
    setBusyId(c.id);
    try {
      await updateCommissionRate(c.id, pct);
      setSavedId(c.id);
      setTimeout(() => setSavedId((prev) => (prev === c.id ? null : prev)), 1500);
    } catch (e) {
      alert('Kaydedilemedi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
          <th className="p-2.5">Kategori</th>
          <th className="p-2.5">Komisyon Oranı (%)</th>
          <th className="p-2.5" />
        </tr>
      </thead>
      <tbody>
        {categories.map((c) => (
          <tr key={c.id} className="border-b border-[#1E2A42]">
            <td className="p-2.5 text-white">{c.name}</td>
            <td className="p-2.5">
              <input
                type="number" min={0} max={100} step={0.5}
                defaultValue={c.commission_pct}
                onChange={(e) => setRates((prev) => ({ ...prev, [c.id]: Number(e.target.value) }))}
                className="w-20 rounded px-2 py-1 text-white"
                style={{ background: '#0B1220', border: '1px solid #2A3650' }}
              />
            </td>
            <td className="p-2.5">
              <button
                onClick={() => handleSave(c)}
                disabled={busyId === c.id}
                className="px-2 py-1 rounded text-[10px] font-bold"
                style={{ border: '1px solid #2A3650', color: savedId === c.id ? '#10B981' : '#5E7090' }}
              >
                <i className="fas fa-check mr-1" />{savedId === c.id ? 'Kaydedildi' : 'Kaydet'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══ Ürün Önerileri ══════════════════════════════════════════════════════
function SuggestionsTab({
  suggestions, catalogOptions, busyId, setBusyId, reload,
}: {
  suggestions: PendingSuggestion[];
  catalogOptions: CatalogOption[];
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  reload: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});

  if (suggestions.length === 0) {
    return <div className="text-[#5E7090] text-xs py-5">Bekleyen ürün önerisi yok.</div>;
  }

  const handleAccept = async (s: PendingSuggestion) => {
    const catalogId = selected[s.id];
    if (!catalogId) return alert('Önce bu öneriyi hangi katalog ürününe bağlayacağınızı seçin.');
    setBusyId(s.id);
    try {
      await acceptSuggestion(s.id, catalogId);
      reload();
    } catch (e) {
      alert('İşlem başarısız: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    try {
      await rejectSuggestion(id);
      reload();
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
          <th className="p-2.5">Öneren Bayi</th>
          <th className="p-2.5">Ürün</th>
          <th className="p-2.5">Kategori</th>
          <th className="p-2.5">Tedarikçi Bilgisi</th>
          <th className="p-2.5">İşlem</th>
        </tr>
      </thead>
      <tbody>
        {suggestions.map((s) => (
          <tr key={s.id} className="border-b border-[#1E2A42]">
            <td className="p-2.5 text-white">{s.stores?.name || '—'}</td>
            <td className="p-2.5 text-white">{s.product_name}</td>
            <td className="p-2.5 text-[#A3B3D1]">{s.categories?.name || '—'}</td>
            <td className="p-2.5 text-[#5E7090]" style={{ fontSize: 11 }}>{s.supplier_contact_info || '—'}</td>
            <td className="p-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  value={selected[s.id] ?? ''}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  className="rounded px-2 py-1 text-[11px] text-white"
                  style={{ background: '#0B1220', border: '1px solid #2A3650' }}
                >
                  <option value="">— katalog ürünü seç —</option>
                  {catalogOptions.map((cp) => (
                    <option key={cp.id} value={cp.id}>{cp.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleAccept(s)}
                  disabled={busyId === s.id}
                  className="px-2 py-1 rounded text-[10px] font-bold"
                  style={{ background: '#10B98120', color: '#10B981', border: '1px solid #10B98150' }}
                >
                  <i className="fas fa-check mr-1" />Kabul Et
                </button>
                <button
                  onClick={() => handleReject(s.id)}
                  disabled={busyId === s.id}
                  className="px-2 py-1 rounded text-[10px] font-bold"
                  style={{ background: '#EF444420', color: '#EF4444', border: '1px solid #EF444450' }}
                >
                  <i className="fas fa-xmark mr-1" />Reddet
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══ Bayi Kazançları ═════════════════════════════════════════════════════
function EarningsTab({
  earnings, busyId, setBusyId, reload,
}: {
  earnings: DealerEarning[];
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  reload: () => void;
}) {
  if (earnings.length === 0) {
    return <div className="text-[#5E7090] text-xs py-5">Henüz hesaplanmış bir dönem yok (her ayın ilk iş günü otomatik hesaplanır).</div>;
  }

  const handleMarkPaid = async (id: string) => {
    const method = prompt('Ödeme yöntemi (USDT / bank / wallet):', 'USDT');
    if (!method) return;
    setBusyId(id);
    try {
      await markEarningPaid(id, method);
      reload();
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
          <th className="p-2.5">Bayi</th>
          <th className="p-2.5">Dönem</th>
          <th className="p-2.5">Satış Komisyonu</th>
          <th className="p-2.5">Referral Bonus</th>
          <th className="p-2.5">Toplam</th>
          <th className="p-2.5">Durum</th>
          <th className="p-2.5" />
        </tr>
      </thead>
      <tbody>
        {earnings.map((r) => (
          <tr key={r.id} className="border-b border-[#1E2A42]">
            <td className="p-2.5 text-white">{r.stores?.name || '—'}</td>
            <td className="p-2.5 text-[#A3B3D1]">{monthLabel(r.period_year, r.period_month)}</td>
            <td className="p-2.5 text-white font-mono">{fmtMoney(r.gross_commission)}</td>
            <td className="p-2.5 font-mono" style={{ color: '#D4AF37' }}>{fmtMoney(r.referral_bonus)}</td>
            <td className="p-2.5 text-white font-mono font-bold">{fmtMoney(r.total_payable)}</td>
            <td className="p-2.5">
              <span
                className="px-2 py-0.5 rounded text-[10px] font-bold"
                style={{
                  background: r.payment_status === 'paid' ? '#10B98120' : '#F59E0B20',
                  color: r.payment_status === 'paid' ? '#10B981' : '#F59E0B',
                }}
              >
                {r.payment_status === 'paid' ? 'Ödendi' : 'Bekliyor'}
              </span>
            </td>
            <td className="p-2.5">
              {r.payment_status === 'pending' ? (
                <button
                  onClick={() => handleMarkPaid(r.id)}
                  disabled={busyId === r.id}
                  className="px-2 py-1 rounded text-[10px] font-bold"
                  style={{ background: '#10B98120', color: '#10B981', border: '1px solid #10B98150' }}
                >
                  <i className="fas fa-money-bill mr-1" />Ödendi İşaretle
                </button>
              ) : (
                <span className="text-[10px] text-[#5E7090]">{r.payment_method || ''}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
