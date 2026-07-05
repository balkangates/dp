import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bid, SIMULATED_USERS, formatPrice, formatTimer } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { placeBid, subscribeToAuction, AUCTION_EXTEND_MINUTES } from '../lib/supabase';
import confetti from 'canvas-confetti';

// Supabase ihale yapısı (App.tsx'den geliyor)
export interface SupabaseAuction {
  id: string;
  current_bid: number | null;
  start_price: number;
  bid_count: number;
  end_time: string;
  bid_increment: number;
  winner_id: string | null;
  status: string;
  extended_count: number;
  products?: { title: string; description: string; image_url: string; category: string } | null;
  // Fallback: data.ts AuctionItem alanları da destekleniyor
  title?: string;
  description?: string;
  image?: string;
  lot?: number;
  viewerCount?: number;
  minIncrement?: number;
  timeLeft?: number;
  duration?: number;
  leaderName?: string | null;
  leader?: string | null;
}

interface AuctionPanelProps {
  auction: SupabaseAuction;
  onBid: (auctionId: string, amount: number) => void;
  onAuctionEnd: (auctionId: string) => void;
}

// Supabase ihalesi için gerekli alanları normalize et
function normalize(auction: SupabaseAuction) {
  const endMs = auction.end_time ? new Date(auction.end_time).getTime() : Date.now() + 60000;
  const nowMs = Date.now();
  const timeLeft = Math.max(0, Math.floor((endMs - nowMs) / 1000));
  const duration = auction.duration ?? timeLeft + 60;
  return {
    title: auction.products?.title ?? auction.title ?? 'İhale',
    description: auction.products?.description ?? auction.description ?? '',
    currentPrice: auction.current_bid ?? auction.start_price ?? 0,
    minIncrement: auction.bid_increment ?? auction.minIncrement ?? 250,
    bidCount: auction.bid_count ?? 0,
    lot: auction.lot ?? 1,
    viewerCount: auction.viewerCount ?? Math.floor(Math.random() * 200) + 50,
    timeLeft,
    duration,
    leaderName: auction.leaderName ?? null,
  };
}

export default function AuctionPanel({ auction, onBid, onAuctionEnd }: AuctionPanelProps) {
  const { user, profile } = useAuth();
  const norm = normalize(auction);

  const [timeLeft, setTimeLeft] = useState(norm.timeLeft);
  const [currentPrice, setCurrentPrice] = useState(norm.currentPrice);
  const [leader, setLeader] = useState(norm.leaderName || 'Henüz teklif yok');
  const [bids, setBids] = useState<Bid[]>([]);
  const [isPriceAnimating, setIsPriceAnimating] = useState(false);
  const [isCrownAnimating, setIsCrownAnimating] = useState(false);
  const [bidAmount, setBidAmount] = useState('');
  const [showWinner, setShowWinner] = useState(false);
  const [bidCount, setBidCount] = useState(norm.bidCount);
  const [isPlacingBid, setIsPlacingBid] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const bidListRef = useRef<HTMLDivElement>(null);
  const isRealAuction = !auction.id.startsWith('auc'); // data.ts'deki simüle id'ler 'auc' ile başlıyor

  // ─── Countdown ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (timeLeft <= 0) {
      setShowWinner(true);
      confetti({
        particleCount: 150, spread: 100,
        origin: { x: 0.8, y: 0.3 },
        colors: ['#D4AF37', '#F5D76E', '#10B981', '#38BDF8', '#FF007A'],
      });
      onAuctionEnd(auction.id);
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { clearInterval(timer); return 0; } return t - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [auction.id]); // eslint-disable-line

  // ─── Realtime Supabase Subscription ──────────────────────────────────────
  useEffect(() => {
    if (!isRealAuction) return;

    const channel = subscribeToAuction(
      auction.id,
      // Yeni teklif geldi
      (payload) => {
        const newBidData = (payload as { new: { amount: number; bidder_id: string; id: string } }).new;
        if (!newBidData) return;

        const newBid: Bid = {
          id: newBidData.id,
          userId: newBidData.bidder_id,
          userName: newBidData.bidder_id === user?.id ? (profile?.full_name ?? 'Sen') : 'Kullanıcı',
          avatar: newBidData.bidder_id === user?.id ? '🎯' : SIMULATED_USERS[Math.floor(Math.random() * SIMULATED_USERS.length)].avatar,
          amount: newBidData.amount,
          timestamp: Date.now(),
        };

        setCurrentPrice(newBidData.amount);
        setBids(prev => [newBid, ...prev].slice(0, 20));
        setBidCount(c => c + 1);
        setIsPriceAnimating(true);
        setTimeout(() => setIsPriceAnimating(false), 600);

        if (newBidData.bidder_id !== user?.id) {
          setLeader('Başka Kullanıcı');
          setIsCrownAnimating(true);
          setTimeout(() => setIsCrownAnimating(false), 800);
        }
      },
      // Auction güncellendi (süre uzatıldı vs.)
      (payload) => {
        const updated = (payload as { new: { current_bid: number; bid_count: number; end_time: string } }).new;
        if (!updated) return;
        if (updated.current_bid) setCurrentPrice(updated.current_bid);
        if (updated.bid_count) setBidCount(updated.bid_count);
        if (updated.end_time) {
          const newTimeLeft = Math.max(0, Math.floor((new Date(updated.end_time).getTime() - Date.now()) / 1000));
          setTimeLeft(newTimeLeft);
        }
      }
    );

    return () => { supabaseCleanup(channel); };
  }, [auction.id, isRealAuction, user?.id, profile?.full_name]);

  // ─── Simülasyon (sadece data.ts ihalelerinde) ─────────────────────────────
  useEffect(() => {
    if (isRealAuction || timeLeft <= 0) return;
    const iv = setInterval(() => {
      if (Math.random() > 0.4) {
        const u = SIMULATED_USERS[Math.floor(Math.random() * SIMULATED_USERS.length)];
        const inc = norm.minIncrement * (1 + Math.floor(Math.random() * 3));
        const newPrice = currentPrice + inc;
        setBids(prev => [{
          id: Date.now().toString(),
          userId: u.id, userName: u.name, avatar: u.avatar,
          amount: newPrice, timestamp: Date.now(),
        }, ...prev].slice(0, 20));
        setCurrentPrice(newPrice);
        setBidCount(c => c + 1);
        setLeader(u.name);
        setIsPriceAnimating(true);
        setTimeout(() => setIsPriceAnimating(false), 600);
        setIsCrownAnimating(true);
        setTimeout(() => setIsCrownAnimating(false), 800);
      }
    }, 3000 + Math.random() * 4000);
    return () => clearInterval(iv);
  }, [currentPrice, timeLeft, isRealAuction, norm.minIncrement]);

  // ─── Teklif Ver ──────────────────────────────────────────────────────────
  const handleBid = useCallback(async () => {
    const amount = bidAmount ? parseFloat(bidAmount) : currentPrice + norm.minIncrement;
    if (amount <= currentPrice) {
      setBidError(`Teklifiniz mevcut fiyattan (${formatPrice(currentPrice)}) yüksek olmalı.`);
      return;
    }
    setBidError(null);

    // İHALE PANEL: Anlık UI güncellemesi (optimistic update)
    const optimisticBid: Bid = {
      id: `opt_${Date.now()}`,
      userId: user?.id ?? 'self',
      userName: profile?.full_name ?? 'Sen',
      avatar: '🎯',
      amount,
      timestamp: Date.now(),
    };
    setCurrentPrice(amount);
    setBids(prev => [optimisticBid, ...prev].slice(0, 20));
    setBidCount(c => c + 1);
    setLeader(profile?.full_name ?? 'Sen');
    setIsPriceAnimating(true);
    setIsCrownAnimating(true);
    setTimeout(() => setIsPriceAnimating(false), 600);
    setTimeout(() => setIsCrownAnimating(false), 800);
    setBidAmount('');
    confetti({ particleCount: 30, spread: 60, origin: { x: 0.8, y: 0.5 }, colors: ['#D4AF37', '#F5D76E'] });

    // Supabase'e gönder (gerçek ihale ise)
    if (isRealAuction && user?.id) {
      setIsPlacingBid(true);
      try {
        const { error } = await placeBid(auction.id, user.id, amount);
        if (error) {
          setBidError('Teklif gönderilemedi: ' + error.message);
          // Rollback optimistic update
          setCurrentPrice(currentPrice);
          setBids(prev => prev.filter(b => b.id !== optimisticBid.id));
          setBidCount(c => c - 1);
        }

        // Son AUCTION_EXTEND_MINUTES içinde teklif gelirse süreyi uzat
        if (!error && timeLeft <= AUCTION_EXTEND_MINUTES * 60) {
          const extendedEnd = new Date(Date.now() + AUCTION_EXTEND_MINUTES * 60 * 1000).toISOString();
          await import('../lib/supabase').then(m => m.extendAuction(auction.id, extendedEnd));
        }
      } finally {
        setIsPlacingBid(false);
      }
    }

    onBid(auction.id, amount);
  }, [bidAmount, currentPrice, auction, user, profile, isRealAuction, norm.minIncrement, timeLeft, onBid]);

  const progressPercent = (timeLeft / (norm.duration || 60)) * 100;
  const isUrgent = timeLeft <= 10;

  return (
    <div className="pulse-glow rounded-2xl border-2 border-[rgba(212,175,55,0.3)] flex flex-col h-full" style={{ background: '#131C2C' }}>
      {/* Header */}
      <div className="p-4 pb-3 border-b border-[#2A3650]">
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="bg-[rgba(212,175,55,0.1)] text-[#D4AF37] border border-[rgba(212,175,55,0.4)] text-[10px] font-mono px-2 py-0.5 rounded font-bold">
                LOT #{norm.lot}
              </span>
              <span className="bg-[rgba(239,68,68,0.1)] text-red-400 text-[10px] font-mono px-2 py-0.5 rounded font-bold border border-red-500/30">
                CANLI TEKLİF
              </span>
              {isRealAuction && (
                <span className="bg-[rgba(16,185,129,0.1)] text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded font-bold border border-emerald-500/30">
                  ● CANLI
                </span>
              )}
            </div>
            <h2 className="text-white font-extrabold text-base leading-tight truncate">{norm.title}</h2>
            <p className="text-[#5E7090] text-[11px] mt-1 truncate">{norm.description}</p>
          </div>
          {/* Timer */}
          <div className="shrink-0 bg-[#090d16] border border-[#2A3650] rounded-xl px-3 py-2 text-center min-w-[80px]">
            <p className="text-[9px] text-[#5E7090] font-bold font-mono">KALAN SÜRE</p>
            <p className={`font-mono text-xl font-black ${isUrgent ? 'urgent-pulse' : 'text-[#10B981]'}`}>
              {showWinner ? '00:00' : formatTimer(timeLeft)}
            </p>
            <div className="w-full h-1 bg-[#2A3650] rounded-full mt-1.5 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: isUrgent ? '#EF4444' : '#10B981', width: `${progressPercent}%` }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Current Price */}
      <div className="px-4 pt-3">
        <div className="bg-[#090d16] border border-[#2A3650] rounded-xl p-4 relative overflow-hidden">
          {isPriceAnimating && <div className="absolute inset-0 shimmer" />}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-[#D4AF37] font-mono font-bold mb-1">GÜNCEL EN YÜKSEK TEKLİF</p>
              <div className={`font-mono text-2xl font-black text-white ${isPriceAnimating ? 'price-pulse' : ''}`}>
                {formatPrice(currentPrice)}
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[#5E7090] font-mono mb-1">TEKLİF SAYISI</p>
              <p className="font-mono text-lg font-bold text-[#38BDF8]">{bidCount}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#5E7090] font-mono">LİDER:</span>
              <motion.div
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${isCrownAnimating ? 'crown-bounce' : ''}`}
                style={{ background: 'linear-gradient(135deg, #D4AF37, #8B6914)', color: '#000' }}
                layout
              >
                <span>👑</span>
                <span>{leader}</span>
              </motion.div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-[#5E7090]">
              <i className="fas fa-users text-[8px]"></i>
              <span className="font-mono">{norm.viewerCount} izleyici</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bid history */}
      <div className="flex-1 px-4 pt-3 min-h-0 overflow-hidden">
        <p className="text-[10px] text-[#5E7090] font-mono font-bold mb-2">SON TEKLİFLER</p>
        <div ref={bidListRef} className="space-y-1.5 max-h-[140px] overflow-y-auto no-scrollbar">
          <AnimatePresence>
            {bids.slice(0, 8).map((bid, i) => (
              <motion.div
                key={bid.id}
                initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg text-[11px] ${i === 0 ? 'bid-flash bg-[#10B981]/10 border border-[#10B981]/20' : 'bg-[#090d16]/50'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{bid.avatar}</span>
                  <span className={`font-bold ${bid.userId === user?.id || bid.userId === 'self' ? 'text-[#D4AF37]' : 'text-white/80'}`}>
                    {bid.userName}
                  </span>
                </div>
                <span className="font-mono font-bold text-[#10B981]">{formatPrice(bid.amount)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {bids.length === 0 && (
            <p className="text-center text-[#5E7090] text-[11px] py-4">Henüz teklif yok. İlk teklifi siz verin!</p>
          )}
        </div>
      </div>

      {/* Hata mesajı */}
      {bidError && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-[11px] font-mono">
          {bidError}
        </div>
      )}

      {/* Winner overlay */}
      <AnimatePresence>
        {showWinner && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 rounded-2xl"
          >
            <motion.div animate={{ rotate: [0, -10, 10, 0], scale: [1, 1.2, 1] }} transition={{ duration: 0.8, repeat: 2 }} className="text-5xl mb-3">🏆</motion.div>
            <p className="text-[#D4AF37] font-mono text-sm font-bold">İHALE KAZANANI</p>
            <p className="text-white font-black text-xl mt-1">👑 {leader}</p>
            <p className="text-[#10B981] font-mono font-bold text-lg mt-2">{formatPrice(currentPrice)}</p>
            <button onClick={() => setShowWinner(false)} className="mt-4 px-6 py-2 rounded-lg bg-[#D4AF37] text-black font-bold text-sm cursor-pointer hover:bg-[#F5D76E] transition-colors">
              Sonraki Lot →
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bid input */}
      <div className="p-4 pt-3 border-t border-[#2A3650] mt-auto">
        {!user && isRealAuction && (
          <p className="text-[10px] text-[#D4AF37] font-mono text-center mb-2">
            <i className="fas fa-lock mr-1"></i>Teklif vermek için giriş yapın
          </p>
        )}
        <div className="flex gap-2">
          <input
            type="number"
            value={bidAmount}
            onChange={(e) => setBidAmount(e.target.value)}
            placeholder={`Min: ${formatPrice(currentPrice + norm.minIncrement)}`}
            disabled={showWinner || isPlacingBid}
            className="bg-[#090d16] border border-[#2A3650] rounded-xl px-3 py-2.5 text-white font-mono font-bold text-sm w-[45%] text-center focus:outline-none focus:border-[#D4AF37] transition-colors placeholder:text-[#5E7090] placeholder:text-[10px] disabled:opacity-50"
          />
          <button
            onClick={handleBid}
            disabled={showWinner || isPlacingBid || (isRealAuction && !user)}
            className="flex-1 rounded-xl font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #F59E0B, #EAB308)', color: '#000' }}
          >
            {isPlacingBid ? <><i className="fas fa-spinner fa-spin"></i> GÖNDERİLİYOR</> : <><i className="fas fa-gavel"></i> TEKLİF GÖNDER</>}
          </button>
        </div>
        <div className="flex items-center gap-4 mt-2">
          {[1, 2, 5].map(mult => (
            <button
              key={mult}
              onClick={() => setBidAmount(String(currentPrice + norm.minIncrement * mult))}
              disabled={showWinner}
              className="flex-1 text-[10px] font-mono font-bold text-[#5E7090] hover:text-[#D4AF37] bg-[#090d16] border border-[#2A3650] rounded-lg py-1.5 cursor-pointer transition-colors hover:border-[#D4AF37]/30 disabled:opacity-50"
            >
              +{formatPrice(norm.minIncrement * mult)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Channel cleanup helper
function supabaseCleanup(channel: ReturnType<typeof subscribeToAuction>) {
  channel.unsubscribe();
}
