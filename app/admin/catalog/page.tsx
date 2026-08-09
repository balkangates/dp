'use client';
import { useEffect, useState } from 'react';
import {
  loadPendingCatalogProducts, approveCatalogProduct, rejectCatalogProduct,
  loadCategories, updateCommissionPct,
} from '@/lib/admin';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export default function AdminCatalogPage() {
  const [pending, setPending] = useState<AnyRow[]>([]);
  const [categories, setCategories] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    const [p, c] = await Promise.all([loadPendingCatalogProducts(), loadCategories()]);
    setPending(p);
    setCategories(c);
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try { await approveCatalogProduct(id); await refresh(); }
    catch (e) { alert('Onaylanamadı: ' + (e as Error).message); }
    finally { setBusyId(null); }
  };

  const handleReject = async (id: string) => {
    if (!confirm('Bu ürünü reddetmek istediğinize emin misiniz?')) return;
    setBusyId(id);
    try { await rejectCatalogProduct(id); await refresh(); }
    catch (e) { alert('Reddedilemedi: ' + (e as Error).message); }
    finally { setBusyId(null); }
  };

  const handleCommissionChange = async (categoryId: string, pct: number) => {
    try {
      await updateCommissionPct(categoryId, pct);
      setCategories((prev) => prev.map((c) => (c.id === categoryId ? { ...c, commission_pct: pct } : c)));
    } catch (e) {
      alert('Güncellenemedi: ' + (e as Error).message);
    }
  };

  if (loading) return <p className="text-[#5E7090] font-mono text-sm">Yükleniyor…</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-white font-bold text-sm mb-3">Onay Bekleyen Tedarikçi Ürünleri ({pending.length})</p>
        {pending.length === 0 ? (
          <p className="text-[#5E7090] text-xs font-mono">Bekleyen ürün yok. 🎉</p>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="rounded-xl p-3 flex items-center justify-between flex-wrap gap-2" style={CARD}>
                <div>
                  <p className="text-white text-sm font-bold">{p.name}</p>
                  <p className="text-[#5E7090] text-xs font-mono">
                    {p.categories?.name ?? '—'} · Teklif fiyat: ₺{p.suggested_price}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(p.id)}
                    disabled={busyId === p.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: '#10B981', color: '#fff' }}
                  >
                    <i className="fas fa-check mr-1" />Onayla
                  </button>
                  <button
                    onClick={() => handleReject(p.id)}
                    disabled={busyId === p.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: '#2A3650', color: '#A3B3D1' }}
                  >
                    <i className="fas fa-xmark mr-1" />Reddet
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-white font-bold text-sm mb-3">Kategori Komisyon Oranları</p>
        <div className="rounded-xl overflow-hidden" style={CARD}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
                <th className="p-2.5">Kategori</th>
                <th className="p-2.5">Komisyon %</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-b border-[#1E2A42]">
                  <td className="p-2.5 text-white">{c.name}</td>
                  <td className="p-2.5">
                    <input
                      type="number" min={0} max={100} defaultValue={c.commission_pct}
                      onBlur={(e) => handleCommissionChange(c.id, Number(e.target.value))}
                      className="w-20 rounded px-2 py-1 text-white text-xs"
                      style={{ background: '#0B1220', border: '1px solid #2A3650' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
