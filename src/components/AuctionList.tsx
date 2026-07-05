import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';

// ─── Tipler ────────────────────────────────────────────────────────────────────
interface Sector {
  id: string;
  label: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
}

interface AuctionRow {
  id: string;
  current_bid: number | null;
  start_price: number | null;
  bid_count: number;
  end_time: string;
  bid_increment: number;
  winner_id: string | null;
  status: string;
  extended_count: number;
  auction_type: string | null;
  quantity: string | null;
  quantity_unit: string | null;
  products: {
    id: string;
    title: string;
    image_url: string | null;
    category: string | null;
    sector: string | null;
    price: number;
  } | null;
}

interface AuctionListProps {
  activeId: string;
  onSelect: (id: string) => void;
}

// ─── Yardımcılar ───────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined) {
  if (!n && n !== 0) return '—';
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0 }).format(n) + '₺';
}

function fmtTimer(secs: number): string {
  if (secs <= 0) return 'Bitti';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}s ${String(m).padStart(2,'0')}d`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ─── Ana Bileşen ────────────────────────────────────────────────────────────────
export default function AuctionList({ activeId, onSelect }: AuctionListProps) {

  const [sectors, setSectors]   = useState<Sector[]>([]);
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [filter, setFilter]     = useState<string>('all');
  const [loading, setLoading]   = useState(true);
  const [timers, setTimers]     = useState<Record<string, number>>({});
  const channelRef              = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── 1. Sektörler ─────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('sectors')
      .select('id, label, icon, color, sort_order')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setSectors(data);
      });
  }, []);

  // ── 2. İhaleler — fetch + realtime ───────────────────────────────────────────
  useEffect(() => {
    fetchAuctions();
    subscribeRealtime();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchAuctions() {
    setLoading(true);
    const { data, error } = await supabase
      .from('auctions')
      .select(`
        id,
        current_bid,
        start_price,
        bid_count,
        end_time,
        bid_increment,
        winner_id,
        status,
        extended_count,
        auction_type,
        quantity,
        quantity_unit,
        products (
          id,
          title,
          image_url,
          category,
          sector,
          price
        )
      `)
      .eq('status', 'active')
      .order('end_time', { ascending: true })
      .limit(20);

    if (!error && data) {
      setAuctions(data as AuctionRow[]);
      // Timer başlat
      const init: Record<string, number> = {};
      data.forEach(a => {
        init[a.id] = a.end_time
          ? Math.max(0, Math.floor((new Date(a.end_time).getTime() - Date.now()) / 1000))
          : 0;
      });
      setTimers(init);
    }
    setLoading(false);
  }

  function subscribeRealtime() {
    // Önceki kanalı temizle
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const ch = supabase
      .channel('auction-list-live')
      // auctions tablosu güncellemeleri (current_bid, bid_count, status)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'auctions',
        filter: 'status=eq.active',
      }, (payload) => {
        const updated = payload.new as Partial<AuctionRow> & { id: string };
        setAuctions(prev =>
          prev.map(a => a.id === updated.id ? { ...a, ...updated } : a)
        );
        // Timer güncelle
        if (updated.end_time) {
          setTimers(prev => ({
            ...prev,
            [updated.id]: Math.max(0, Math.floor((new Date(updated.end_time!).getTime() - Date.now()) / 1000)),
          }));
        }
      })
      // Yeni ihale açıldıysa listeye ekle
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'auctions',
      }, () => {
        // Yeni ihaleyi tam JOIN ile çekmek için refresh
        fetchAuctions();
      })
      // İhale kapandıysa listeden çıkar (status != active)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'auctions',
      }, (payload) => {
        const row = payload.new as { id: string; status: string };
        if (row.status !== 'active') {
          setAuctions(prev => prev.filter(a => a.id !== row.id));
        }
      })
      // auction_bids gelince anlık bid_count / current_bid güncelle
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'auction_bids',
      }, (payload) => {
        const bid = payload.new as { auction_id: string; amount: number };
        setAuctions(prev =>
          prev.map(a =>
            a.id === bid.auction_id
              ? { ...a, current_bid: bid.amount, bid_count: (a.bid_count ?? 0) + 1 }
              : a
          )
        );
      })
      .subscribe();

    channelRef.current = ch;
  }

  // ── 3. Countdown timer (her saniye) ──────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setTimers(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { if (next[k] > 0) next[k]--; });
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // ── 4. Filtrele ───────────────────────────────────────────────────────────────
  const filtered = filter === 'all'
    ? auctions
    : auctions.filter(a => a.products?.sector === filter);

  const liveCount = auctions.length;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-[#2A3650] p-6" style={{ background: '#131C2C' }}>

      {/* Başlık */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-white font-extrabold text-base flex items-center gap-2">
          <i className="fas fa-fire text-[#EF4444]"></i>
          CANLI İHALELER
          <span className="bg-red-500/20 text-red-400 text-[10px] font-mono px-2 py-0.5 rounded-full">
            {liveCount} AKTİF
          </span>
        </h3>
        <span className="text-[9px] text-emerald-400 font-mono flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block"></span>
          Canlı veri
        </span>
      </div>

      {/* Sektör filtreleri — sectors tablosundan */}
      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar pb-1">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer transition-all ${
            filter === 'all'
              ? 'bg-[#D4AF37] text-black'
              : 'bg-[#090d16] text-[#5E7090] border border-[#2A3650] hover:border-[#D4AF37]/30 hover:text-[#D4AF37]'
          }`}
        >
          Tümü
        </button>
        {sectors.map(s => (
          <button
            key={s.id}
            onClick={() => setFilter(s.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer transition-all flex items-center gap-1 ${
              filter === s.id
                ? 'text-black'
                : 'bg-[#090d16] text-[#5E7090] border border-[#2A3650] hover:border-[#D4AF37]/30 hover:text-[#D4AF37]'
            }`}
            style={filter === s.id ? { background: s.color ?? '#D4AF37' } : {}}
          >
            {s.icon && <span className="text-[12px]">{s.icon}</span>}
            {s.label}
          </button>
        ))}
      </div>

      {/* Kart listesi */}
      <div className="space-y-3 max-h-[420px] overflow-y-auto no-scrollbar">

        {/* Yükleniyor */}
        {loading && (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="flex gap-3 p-4 rounded-xl border border-[#2A3650]">
                <div className="w-[72px] h-[72px] rounded-lg skeleton shrink-0"></div>
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 skeleton rounded w-2/3"></div>
                  <div className="h-3 skeleton rounded w-1/2"></div>
                  <div className="h-3 skeleton rounded w-1/3"></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Boş */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-10 text-[#5E7090]">
            <i className="fas fa-gavel text-2xl mb-3 block opacity-30"></i>
            <p className="font-mono text-xs">
              {filter === 'all' ? 'Aktif ihale bulunamadı.' : 'Bu sektörde aktif ihale yok.'}
            </p>
          </div>
        )}

        {/* Kartlar */}
        {!loading && filtered.map((auction, idx) => {
          const isActive  = auction.id === activeId;
          const t         = timers[auction.id] ?? 0;
          const urgent    = t > 0 && t <= 300;  // son 5 dk
          const critical  = t > 0 && t <= 60;   // son 1 dk
          const price     = auction.current_bid ?? auction.start_price ?? 0;
          const title     = auction.products?.title ?? 'İhale';
          const imageUrl  = auction.products?.image_url ?? null;
          const typeLabel = auction.auction_type === 'descending' ? '↓ Azalan' : '↑ Artan';
          const typeColor = auction.auction_type === 'descending' ? '#38BDF8' : '#10B981';

          return (
            <motion.div
              key={auction.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onSelect(auction.id)}
              className={`flex gap-3 p-4 rounded-xl cursor-pointer transition-all border ${
                isActive
                  ? 'border-[#D4AF37] shadow-[0_0_14px_rgba(212,175,55,0.15)]'
                  : 'border-[#2A3650] bg-[#090d16] hover:border-[#D4AF37]/30'
              }`}
              style={isActive ? { background: 'rgba(212,175,55,0.05)' } : {}}
            >
              {/* Görsel */}
              <div className="w-[72px] h-[72px] rounded-lg overflow-hidden shrink-0 relative flex items-center justify-center"
                style={{ background: '#1a2540' }}>
                {imageUrl ? (
                  <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
                ) : (
                  <i className="fas fa-gavel text-[#5E7090] text-xl"></i>
                )}
                {/* LIVE rozet */}
                <span className="absolute top-0.5 left-0.5 bg-red-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <span className="w-1 h-1 bg-white rounded-full animate-pulse"></span>
                  LIVE
                </span>
              </div>

              {/* İçerik */}
              <div className="flex-1 min-w-0">
                {/* Üst satır: tip + sector */}
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{ background: typeColor + '18', color: typeColor }}>
                    {typeLabel}
                  </span>
                  {auction.products?.sector && (
                    <span className="text-[9px] font-mono text-[#5E7090]">
                      {sectors.find(s => s.id === auction.products?.sector)?.label ?? auction.products.sector}
                    </span>
                  )}
                  {auction.quantity && (
                    <span className="text-[9px] font-mono text-[#5E7090]">
                      · {auction.quantity} {auction.quantity_unit}
                    </span>
                  )}
                </div>

                {/* Ürün adı */}
                <p className="text-white font-bold text-xs truncate mb-1.5">{title}</p>

                {/* Fiyat + timer */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono font-black text-[#10B981] text-xs">{fmt(price)}</span>
                    <span className="text-[#5E7090] text-[9px] font-mono ml-1">
                      · {auction.bid_count} teklif
                    </span>
                  </div>
                  <span className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
                    critical ? 'bg-red-500/20 text-red-400 animate-pulse' :
                    urgent   ? 'bg-amber-500/20 text-amber-400' :
                               'text-[#5E7090]'
                  }`}>
                    <i className="fas fa-clock mr-1"></i>{fmtTimer(t)}
                  </span>
                </div>
              </div>

              {/* Seçili göstergesi */}
              {isActive && (
                <div className="shrink-0 self-center ml-1">
                  <div className="w-2 h-2 rounded-full bg-[#D4AF37]" style={{ boxShadow: '0 0 6px #D4AF37' }}></div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
