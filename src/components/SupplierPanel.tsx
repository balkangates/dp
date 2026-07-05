/**
 * SupplierPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Tedarikçi (supplier) dashboard: browse active reverse auctions, submit a
 * bid, see own rank (never competitors' actual bids — enforced both by RLS
 * on supplier_bids and by only calling fn_my_bid_rank(), which returns
 * aggregate stats, not other suppliers' rows), and track shipments.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getActiveReverseAuctions,
  submitBid,
  getMyBidRank,
  getSupplierShipments,
  subscribeToAuctionBids,
  type ReverseAuction,
  type SupplierBidRank,
} from '../lib/dampingvar';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

function timeLeft(endTime: string) {
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return 'Süresi doldu';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}sa ${m}dk`;
}

function AuctionCard({ auction, supplierId }: { auction: ReverseAuction; supplierId: string }) {
  const [bid, setBid] = useState('');
  const [rank, setRank] = useState<SupplierBidRank | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRank = useCallback(async () => {
    try {
      const r = await getMyBidRank(auction.id, supplierId);
      setRank(r);
    } catch {
      /* no bid yet — fine */
    }
  }, [auction.id, supplierId]);

  useEffect(() => {
    loadRank();
    const unsubscribe = subscribeToAuctionBids(auction.id, loadRank);
    return unsubscribe;
  }, [auction.id, loadRank]);

  const handleSubmit = async () => {
    const price = Number(bid);
    if (!price || price <= 0) {
      setError('Geçerli bir birim fiyat girin.');
      return;
    }
    if (price > auction.ceiling_price) {
      setError(`Teklif tavan fiyatın (₺${auction.ceiling_price}) üzerinde olamaz.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitBid(auction.id, supplierId, price);
      setBid('');
      await loadRank();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={CARD}>
      <div className="flex items-center justify-between">
        <p className="text-white font-extrabold text-sm">{auction.product_name}</p>
        <span className="text-[10px] font-mono text-[#D4AF37]">{timeLeft(auction.end_time)}</span>
      </div>
      <p className="text-[11px] text-[#5E7090] font-mono">
        Toplam {auction.total_quantity} {auction.quantity_unit} · Tavan fiyat ₺{auction.ceiling_price}/birim
      </p>

      {rank && rank.my_rank && (
        <div className="rounded-lg bg-black/30 px-3 py-2 text-[11px] font-mono">
          <span className={rank.my_rank === 1 ? 'text-[#10B981] font-bold' : 'text-[#A3B3D1]'}>
            Sıralamanız: {rank.my_rank} / {rank.total_bidders}
          </span>
          {rank.my_rank !== 1 && rank.lowest_price && (
            <span className="text-[#5E7090]"> · En düşük teklif ₺{rank.lowest_price}</span>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="number"
          placeholder="Birim fiyatınız (₺)"
          value={bid}
          onChange={(e) => setBid(e.target.value)}
          className="flex-1 bg-black/30 border border-[#2A3650] rounded-lg px-3 py-2 text-sm text-white"
        />
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="rounded-lg px-4 py-2 text-xs font-extrabold"
          style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? '…' : rank?.my_rank ? 'Güncelle' : 'Teklif Ver'}
        </button>
      </div>
      {error && <p className="text-red-400 text-[11px] font-mono">{error}</p>}
    </div>
  );
}

export default function SupplierPanel() {
  const { user, profile } = useAuth();
  const [auctions, setAuctions] = useState<ReverseAuction[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [a, s] = await Promise.all([getActiveReverseAuctions(), getSupplierShipments(user.id)]);
      setAuctions(a);
      setShipments(s);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30000);
    return () => clearInterval(iv);
  }, [refresh]);

  if (profile?.role !== 'supplier') {
    return (
      <div className="rounded-2xl border border-[#2A3650] p-8 text-center" style={CARD}>
        <p className="text-[#A3B3D1] font-mono text-sm">Bu panel yalnızca tedarikçi hesapları için kullanılabilir.</p>
      </div>
    );
  }

  if (loading) return <div className="text-[#5E7090] font-mono text-sm py-10 text-center">Yükleniyor…</div>;

  return (
    <div className="space-y-5">
      <h2 className="text-white font-black text-xl">📦 Tedarikçi Paneli</h2>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-red-300 text-xs font-mono">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl p-4" style={CARD}>
          <p className="text-[9px] text-[#5E7090] font-mono font-bold mb-1 uppercase">Açık İhaleler</p>
          <p className="text-white font-mono font-extrabold text-lg">{auctions.length}</p>
        </div>
        <div className="rounded-xl p-4" style={CARD}>
          <p className="text-[9px] text-[#5E7090] font-mono font-bold mb-1 uppercase">Sevkiyatlar</p>
          <p className="text-white font-mono font-extrabold text-lg">{shipments.length}</p>
        </div>
      </div>

      <div>
        <p className="text-white font-extrabold text-sm mb-3">Açık İhaleler</p>
        {auctions.length === 0 ? (
          <p className="text-[#5E7090] text-xs font-mono">Şu anda açık ihale yok.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {auctions.map((a) => (
              <AuctionCard key={a.id} auction={a} supplierId={user!.id} />
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl p-5" style={CARD}>
        <p className="text-white font-extrabold text-sm mb-3">Sevkiyatlarım</p>
        {shipments.length === 0 ? (
          <p className="text-[#5E7090] text-xs font-mono">Henüz sevkiyat yok.</p>
        ) : (
          <div className="space-y-2">
            {shipments.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg px-3 py-2 bg-black/20 text-xs">
                <span className="text-white font-mono">{s.id.slice(0, 8)}…</span>
                <span className="text-[#D4AF37] font-mono">{s.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
