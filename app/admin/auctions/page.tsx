'use client';
import { useEffect, useState } from 'react';
import { loadResolvableAuctions, closeExpiredAuctions, approveAuctionWinner, cancelAuction } from '@/lib/admin';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export default function AdminAuctionsPage() {
  const [auctions, setAuctions] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => loadResolvableAuctions().then(setAuctions);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const handleCloseExpired = async () => {
    try {
      const n = await closeExpiredAuctions();
      alert(`${n} ihale süresi dolduğu için kapatıldı.`);
      refresh();
    } catch (e) {
      alert('İşlem başarısız: ' + (e as Error).message);
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('En düşük teklifi kazanan ilan etmek istediğinize emin misiniz? Bu işlem sevkiyatı otomatik açar ve geri alınamaz.')) return;
    setBusyId(id);
    try {
      await approveAuctionWinner(id);
      await refresh();
    } catch (e) {
      alert('Onaylanamadı: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (id: string) => {
    const reason = prompt('İptal sebebi (opsiyonel):') ?? undefined;
    setBusyId(id);
    try {
      await cancelAuction(id, reason);
      await refresh();
    } catch (e) {
      alert('İptal edilemedi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="text-[#5E7090] font-mono text-sm">Yükleniyor…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white font-bold text-sm">Sonuçlanmayı Bekleyen İhaleler ({auctions.length})</p>
        <button onClick={handleCloseExpired} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ border: '1px solid #2A3650', color: '#5E7090' }}>
          <i className="fas fa-clock mr-1.5" />Süresi Dolanları Kapat
        </button>
      </div>

      {auctions.length === 0 ? (
        <p className="text-[#5E7090] text-xs font-mono">Bekleyen ihale yok.</p>
      ) : (
        <div className="space-y-3">
          {auctions.map((a) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const bids = (a.supplier_bids || []).filter((b: any) => b.status !== 'withdrawn').sort((x: any, y: any) => x.unit_price - y.unit_price);
            const expired = new Date(a.end_time) < new Date();
            return (
              <div key={a.id} className="rounded-xl p-4" style={CARD}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-white font-bold text-sm">{a.product_name}</p>
                    <p className="text-[#5E7090] text-xs font-mono">
                      Toplam {a.total_quantity} {a.quantity_unit} · Tavan ₺{a.ceiling_price}/birim ·{' '}
                      {expired ? <span className="text-red-400">Süresi doldu</span> : <span>Bitiş: {new Date(a.end_time).toLocaleString('tr-TR')}</span>}
                      {' '}· Durum: {a.status}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(a.id)}
                      disabled={busyId === a.id || bids.length === 0}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: bids.length ? '#10B981' : '#2A3650', color: '#fff', opacity: bids.length ? 1 : 0.5 }}
                    >
                      <i className="fas fa-trophy mr-1" />Kazananı Onayla
                    </button>
                    <button
                      onClick={() => handleCancel(a.id)}
                      disabled={busyId === a.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: '#2A3650', color: '#A3B3D1' }}
                    >
                      İptal Et
                    </button>
                  </div>
                </div>

                {bids.length > 0 ? (
                  <div className="mt-3 space-y-1">
                    {bids.map((b: AnyRow, idx: number) => (
                      <div key={b.id} className="flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5" style={{ background: idx === 0 ? '#10B98115' : '#0B1220', border: `1px solid ${idx === 0 ? '#10B98150' : '#1E2A42'}` }}>
                        <span className="text-white">
                          {idx === 0 && <i className="fas fa-crown mr-1.5" style={{ color: '#D4AF37' }} />}
                          {b.profiles?.company_name || b.profiles?.full_name || 'Tedarikçi'}
                        </span>
                        <span className={idx === 0 ? 'font-bold' : ''} style={{ color: idx === 0 ? '#10B981' : '#5E7090' }}>₺{b.unit_price}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[#5E7090] text-xs font-mono mt-2">Henüz teklif yok.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
