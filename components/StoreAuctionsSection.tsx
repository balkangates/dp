'use client';
import { useEffect, useState } from 'react';
import { getStoreActiveAuctions, type StoreWholesaleAuction } from '@/lib/dampingvar';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

function timeLeft(endTime: string) {
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return 'Süresi doldu';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}sa ${m}dk`;
}

// Mağazanın canlı toptan ihale süreci — sadece izleyici görünümü. Teklif
// vermek yalnızca tedarikçilere açık (/supplier/auctions).
export default function StoreAuctionsSection({ storeId }: { storeId: string }) {
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
