import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getPlatformStats, subscribeToPlatformStats } from '../lib/supabase';

export default function StatsBar() {
  const [stats, setStats] = useState({
    totalBids: 12847,
    totalVolume: 8456000,
    activeLots: 5,
    onlineUsers: 3847,
  });
  const [liveUpdating, setLiveUpdating] = useState(false);

  // İlk yükleme: Supabase'den platform_stats çek
  useEffect(() => {
    async function fetchStats() {
      const { data } = await getPlatformStats();
      if (data) {
        setStats({
          totalBids: data.total_bids ?? 12847,
          totalVolume: data.daily_volume ?? 8456000,
          activeLots: data.active_auctions ?? 5,
          onlineUsers: (data.active_buyers ?? 0) + (data.active_sellers ?? 0) || 3847,
        });
        setLiveUpdating(true);
      }
    }
    fetchStats();
  }, []);

  // Realtime: platform_stats değişikliklerini dinle
  useEffect(() => {
    const channel = subscribeToPlatformStats((payload) => {
      const updated = (payload as { new: Record<string, number> }).new;
      if (!updated) return;
      setStats(prev => ({
        totalBids: updated.total_bids ?? prev.totalBids,
        totalVolume: updated.daily_volume ?? prev.totalVolume,
        activeLots: updated.active_auctions ?? prev.activeLots,
        onlineUsers: ((updated.active_buyers ?? 0) + (updated.active_sellers ?? 0)) || prev.onlineUsers,
      }));
    });
    return () => { channel.unsubscribe(); };
  }, []); // eslint-disable-line

  // Simülasyon (DB bağlı değilse kullanıcı deneyimi için)
  useEffect(() => {
    if (liveUpdating) return; // DB canlı ise simülasyon yok
    const iv = setInterval(() => {
      setStats(prev => ({
        totalBids: prev.totalBids + Math.floor(Math.random() * 5),
        totalVolume: prev.totalVolume + Math.floor(Math.random() * 50000),
        activeLots: prev.activeLots,
        onlineUsers: Math.max(100, prev.onlineUsers + Math.floor(Math.random() * 6) - 3),
      }));
    }, 3000);
    return () => clearInterval(iv);
  }, [liveUpdating]);

  const items = [
    { label: 'TOPLAM TEKLİF', value: stats.totalBids.toLocaleString('tr-TR'), icon: 'fas fa-gavel', color: '#D4AF37' },
    { label: 'İŞLEM HACMİ', value: '₺' + (stats.totalVolume / 1000000).toFixed(1) + 'M', icon: 'fas fa-chart-line', color: '#10B981' },
    { label: 'AKTİF LOT', value: stats.activeLots.toString(), icon: 'fas fa-fire', color: '#EF4444' },
    { label: 'ONLINE', value: stats.onlineUsers.toLocaleString('tr-TR'), icon: 'fas fa-users', color: '#38BDF8' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="rounded-xl border border-[#2A3650] p-4 flex items-center gap-3 relative overflow-hidden"
          style={{ background: '#131C2C' }}
        >
          {liveUpdating && i === 0 && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Canlı veri"></span>
          )}
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm" style={{ background: item.color + '15', color: item.color }}>
            <i className={item.icon}></i>
          </div>
          <div>
            <p className="text-[9px] text-[#5E7090] font-mono font-bold">{item.label}</p>
            <p className="text-white font-mono font-extrabold text-sm">{item.value}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
