'use client';
import { useEffect, useState } from 'react';
import { loadPendingSuggestions, acceptSuggestion, rejectSuggestion, loadApprovedCatalogNames } from '@/lib/admin';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export default function AdminSuggestionsPage() {
  const [pending, setPending] = useState<AnyRow[]>([]);
  const [catalogNames, setCatalogNames] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [selectedCatalog, setSelectedCatalog] = useState('');

  const refresh = async () => {
    const [p, c] = await Promise.all([loadPendingSuggestions(), loadApprovedCatalogNames()]);
    setPending(p);
    setCatalogNames(c);
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const handleAccept = async (suggestionId: string) => {
    if (!selectedCatalog) { alert('Bu önerinin hangi onaylı katalog ürününe karşılık geldiğini seçin.'); return; }
    try {
      await acceptSuggestion(suggestionId, selectedCatalog);
      setLinkFor(null);
      setSelectedCatalog('');
      await refresh();
    } catch (e) {
      alert('Kabul edilemedi: ' + (e as Error).message);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm('Bu öneriyi reddetmek istediğinize emin misiniz?')) return;
    try { await rejectSuggestion(id); await refresh(); }
    catch (e) { alert('Reddedilemedi: ' + (e as Error).message); }
  };

  if (loading) return <p className="text-[#5E7090] font-mono text-sm">Yükleniyor…</p>;

  return (
    <div className="space-y-3">
      <p className="text-white font-bold text-sm">Bayilerin Yeni Ürün Önerileri ({pending.length})</p>
      <p className="text-[#5E7090] text-xs font-mono">
        Bayiler kataloglarına olmayan bir ürün önerdiğinde burada listelenir. &quot;Kabul Et&quot;, öneriyi
        mevcut onaylı bir katalog ürününe bağlar (aynı ürün zaten kataloğa eklenmişse) ya da reddedin.
      </p>
      {pending.length === 0 ? (
        <p className="text-[#5E7090] text-xs font-mono">Bekleyen öneri yok. 🎉</p>
      ) : (
        <div className="space-y-2">
          {pending.map((s) => (
            <div key={s.id} className="rounded-xl p-3" style={CARD}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-white text-sm font-bold">{s.name || s.product_name}</p>
                  <p className="text-[#5E7090] text-xs font-mono">
                    {s.stores?.name} · {s.categories?.name ?? '—'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLinkFor(linkFor === s.id ? null : s.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: '#10B981', color: '#fff' }}
                  >
                    <i className="fas fa-check mr-1" />Kabul Et
                  </button>
                  <button
                    onClick={() => handleReject(s.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: '#2A3650', color: '#A3B3D1' }}
                  >
                    <i className="fas fa-xmark mr-1" />Reddet
                  </button>
                </div>
              </div>
              {linkFor === s.id && (
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-dashed border-[#1E2A42]">
                  <select
                    value={selectedCatalog}
                    onChange={(e) => setSelectedCatalog(e.target.value)}
                    className="flex-1 bg-black/30 border border-[#2A3650] rounded-lg px-2 py-1.5 text-xs text-white"
                  >
                    <option value="">Katalog ürünü seçin…</option>
                    {catalogNames.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => handleAccept(s.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: '#D4AF37', color: '#000' }}>
                    Onayla
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
