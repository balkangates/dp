'use client';
import { useEffect, useState } from 'react';
import { loadFinanceSummary, loadDealerEarnings, markEarningPaid } from '@/lib/admin';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export default function AdminFinancePage() {
  const [summary, setSummary] = useState<AnyRow[]>([]);
  const [earnings, setEarnings] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payMethod, setPayMethod] = useState<Record<string, string>>({});

  const refresh = async () => {
    const [s, e] = await Promise.all([loadFinanceSummary().catch(() => []), loadDealerEarnings().catch(() => [])]);
    setSummary(s);
    setEarnings(e);
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const handleMarkPaid = async (id: string) => {
    const method = payMethod[id] || 'havale';
    if (!confirm(`Bu hakedişi "${method}" ile ödendi olarak işaretle?`)) return;
    try { await markEarningPaid(id, method); await refresh(); }
    catch (e) { alert('İşaretlenemedi: ' + (e as Error).message); }
  };

  if (loading) return <p className="text-[#5E7090] font-mono text-sm">Yükleniyor…</p>;

  const totals = summary.reduce(
    (acc, s) => ({
      gross: acc.gross + Number(s.gross_sales || 0),
      commission: acc.commission + Number(s.platform_commission || 0),
      held: acc.held + Number(s.escrow_held || 0),
      released: acc.released + Number(s.escrow_released || 0),
    }),
    { gross: 0, commission: 0, held: 0, released: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Toplam Ciro', value: totals.gross, color: '#D4AF37' },
          { label: 'Platform Komisyonu', value: totals.commission, color: '#10B981' },
          { label: 'Escrow — Bekleyen', value: totals.held, color: '#F59E0B' },
          { label: 'Escrow — Serbest Bırakılan', value: totals.released, color: '#38BDF8' },
        ].map((t) => (
          <div key={t.label} className="rounded-xl p-4" style={CARD}>
            <p className="font-black text-xl" style={{ color: t.color }}>₺{t.value.toLocaleString('tr-TR')}</p>
            <p className="text-[#5E7090] text-xs font-mono mt-1">{t.label}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-white font-bold text-sm mb-3">Mağaza Bazlı Özet</p>
        <div className="rounded-xl overflow-hidden" style={CARD}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#5E7090] border-b border-[#2A3650]">
                <th className="p-2.5">Mağaza</th>
                <th className="p-2.5">Sipariş</th>
                <th className="p-2.5">Ciro</th>
                <th className="p-2.5">Komisyon</th>
                <th className="p-2.5">Bayi Hakedişi</th>
              </tr>
            </thead>
            <tbody>
              {summary.filter((s) => s.order_count > 0).map((s) => (
                <tr key={s.store_id} className="border-b border-[#1E2A42]">
                  <td className="p-2.5 text-white">{s.store_name}</td>
                  <td className="p-2.5 text-[#A3B3D1] font-mono">{s.order_count}</td>
                  <td className="p-2.5 text-[#A3B3D1] font-mono">₺{Number(s.gross_sales).toLocaleString('tr-TR')}</td>
                  <td className="p-2.5 text-[#10B981] font-mono">₺{Number(s.platform_commission).toLocaleString('tr-TR')}</td>
                  <td className="p-2.5 text-[#D4AF37] font-mono">₺{Number(s.dealer_payout).toLocaleString('tr-TR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-white font-bold text-sm mb-3">Bayi Hakediş Ödemeleri (Aylık)</p>
        {earnings.length === 0 ? (
          <p className="text-[#5E7090] text-xs font-mono">Henüz hakediş dönemi kapanmamış.</p>
        ) : (
          <div className="space-y-2">
            {earnings.map((e) => (
              <div key={e.id} className="rounded-xl p-3 flex items-center justify-between flex-wrap gap-2" style={CARD}>
                <div>
                  <p className="text-white text-sm font-bold">{e.stores?.name} — {e.period_month}/{e.period_year}</p>
                  <p className="text-[#5E7090] text-xs font-mono">
                    ₺{Number(e.total_amount ?? e.amount ?? 0).toLocaleString('tr-TR')} ·{' '}
                    {e.payment_status === 'paid' ? <span className="text-[#10B981]">Ödendi ({e.payment_method})</span> : <span className="text-amber-400">Ödenmedi</span>}
                  </p>
                </div>
                {e.payment_status !== 'paid' && (
                  <div className="flex items-center gap-2">
                    <select
                      value={payMethod[e.id] || 'havale'}
                      onChange={(ev) => setPayMethod((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                      className="bg-black/30 border border-[#2A3650] rounded-lg px-2 py-1.5 text-xs text-white"
                    >
                      <option value="havale">Havale/EFT</option>
                      <option value="virman">Virman</option>
                      <option value="nakit">Nakit</option>
                    </select>
                    <button onClick={() => handleMarkPaid(e.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: '#10B981', color: '#fff' }}>
                      Ödendi İşaretle
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
