import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { formatPrice, SIMULATED_USERS } from '../data';
import { getLeaderboard, subscribeToLeaderboard } from '../lib/supabase';

interface LeaderEntry {
  id: string;
  rank: number;
  name: string;
  avatar: string;
  totalSales: number;
  totalRevenue: number;
  growth: number;
  rating: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: Record<string, any>, rank: number): LeaderEntry {
  const profile = row.profiles;
  const name = profile?.company_name ?? profile?.full_name ?? row.seller_name ?? 'Satıcı';
  return {
    id: row.id,
    rank,
    name,
    avatar: profile?.avatar_url ?? SIMULATED_USERS[rank % SIMULATED_USERS.length].avatar,
    totalSales: row.total_sales ?? 0,
    totalRevenue: row.total_revenue ?? 0,
    growth: row.growth ?? 0,
    rating: row.rating ?? profile?.rating ?? 0,
  };
}

// Fallback: Simüle veri (Supabase veri yoksa)
function generateFallback(): LeaderEntry[] {
  return SIMULATED_USERS.slice(0, 7).map((u, i) => ({
    id: u.id,
    rank: i + 1,
    name: u.name,
    avatar: u.avatar,
    totalSales: Math.floor(Math.random() * 50) + 10,
    totalRevenue: Math.floor(Math.random() * 500000) + 50000,
    growth: parseFloat((Math.random() * 30 - 5).toFixed(1)),
    rating: parseFloat((3.5 + Math.random() * 1.5).toFixed(1)),
  }));
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // İlk yükleme
  useEffect(() => {
    async function fetchLeaderboard() {
      const { data, error } = await getLeaderboard(7);
      if (!error && data && data.length > 0) {
        setEntries(data.map((row, i) => mapRow(row, i + 1)));
      } else {
        setEntries(generateFallback());
      }
      setLoading(false);
    }
    fetchLeaderboard();
  }, []);

  // Realtime güncellemeler
  useEffect(() => {
    let active = true;
    const channel = subscribeToLeaderboard(async () => {
      if (!active) return;
      const { data, error } = await getLeaderboard(7);
      if (!error && data && data.length > 0 && active) {
        setEntries(data.map((row, i) => mapRow(row, i + 1)));
      }
    });
    return () => {
      active = false;
      channel.unsubscribe();
    };
  }, []); // eslint-disable-line

  const rankColors = ['#D4AF37', '#C0C0C0', '#CD7F32'];
  const rankIcons = ['👑', '🥈', '🥉'];

  return (
    <div className="rounded-2xl border border-[#2A3650] p-6" style={{ background: '#131C2C' }}>
      <h3 className="text-white font-extrabold text-base flex items-center gap-2 mb-4">
        <i className="fas fa-trophy text-[#D4AF37]"></i>
        CANLI LİDERLİK TABLOSU
      </h3>

      {loading && (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-14 rounded-xl bg-[#090d16] animate-pulse" />
          ))}
        </div>
      )}

      {!loading && (
        <div className="space-y-2">
          {entries.slice(0, 7).map((entry, i) => (
            <motion.div
              key={entry.id}
              layout
              className={`flex items-center gap-3 p-3.5 rounded-xl transition-all ${
                i === 0 ? 'border border-[#D4AF37]/30 bg-[rgba(212,175,55,0.05)]' : 'bg-[#090d16]'
              }`}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black font-mono shrink-0"
                style={{ background: i < 3 ? rankColors[i] + '20' : '#2A3650', color: i < 3 ? rankColors[i] : '#5E7090' }}
              >
                {i < 3 ? rankIcons[i] : `#${entry.rank}`}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{entry.avatar}</span>
                  <span className={`text-xs font-bold truncate ${i === 0 ? 'text-[#D4AF37]' : 'text-white'}`}>
                    {entry.name}
                  </span>
                </div>
                {entry.growth !== 0 && (
                  <p className={`text-[9px] font-mono mt-0.5 ${entry.growth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {entry.growth >= 0 ? '▲' : '▼'} {Math.abs(entry.growth)}% büyüme
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-[#10B981] font-mono font-bold text-xs">{formatPrice(entry.totalRevenue)}</p>
                <p className="text-[#5E7090] font-mono text-[9px]">{entry.totalSales} satış · ⭐{entry.rating.toFixed(1)}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
