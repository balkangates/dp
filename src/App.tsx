import { useState, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Header from './components/Header';
import LiveStream from './components/LiveStream';
import AuctionPanel from './components/AuctionPanel';
import AuctionList from './components/AuctionList';
import ProductGrid from './components/ProductGrid';
import CartSidebar from './components/CartSidebar';
import StatsBar from './components/StatsBar';
import Leaderboard from './components/Leaderboard';
import TradeSignals from './components/TradeSignals';
import AdminPayments from './components/AdminPayments';
import ComingSoon from './components/ComingSoon';
import RequireRole from './components/RequireRole';
import { INITIAL_AUCTIONS, CartItem, Product } from './data';
import { getActiveAuctions, getAuctionWithBids, updateActiveUser } from './lib/supabase';
import { SupabaseAuction } from './components/AuctionPanel';
import { useAuth } from './contexts/AuthContext';

// ─── MODÜL 3.1 — ROUTE TABLOSU ─────────────────────────────────────────────
// SupplierPanel.tsx / FranchisePanel.tsx / AffiliatePanel.tsx / CustomerHome.tsx
// TEMİZLİK turunda (ölü kod) SİLİNDİ — hiçbiri hiçbir yerden import edilmiyordu
// ve üçü '../lib/dampingvar' / eksik supabase.ts export'larına bağımlı olduğu
// için zaten derlenemiyordu. Aşağıdaki <ComingSoon /> route'ları, bu paneller
// gerçek dashboard.html modülleri (bkz. public/modules/) olarak yeniden inşa
// edilene kadar yer tutucu olarak kalıyor.

// ─── Inner App (AuthProvider içinde, useAuth kullanabilir) ───────────────────
function AppInner() {
  const { user } = useAuth();
  const [cartOpen, setCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // İhale state'i: önce statik data, Supabase'den veri gelince güncellenir
  const [auctions, setAuctions] = useState<SupabaseAuction[]>(
    INITIAL_AUCTIONS.map(a => ({
      id: a.id,
      current_bid: a.currentPrice,
      start_price: a.startPrice,
      bid_count: a.bids.length,
      end_time: new Date(Date.now() + a.timeLeft * 1000).toISOString(),
      bid_increment: a.minIncrement,
      winner_id: a.leader,
      status: a.status === 'live' ? 'active' : a.status,
      extended_count: 0,
      title: a.title,
      description: a.description,
      image: a.image,
      lot: a.lot,
      viewerCount: a.viewerCount,
      leaderName: a.leaderName,
      leader: a.leader,
      duration: a.duration,
      timeLeft: a.timeLeft,
      minIncrement: a.minIncrement,
    }))
  );
  const [activeAuctionId, setActiveAuctionId] = useState(INITIAL_AUCTIONS[0].id);
  const [activeAuction, setActiveAuction] = useState<SupabaseAuction>(auctions[0]);

  // Supabase'den gerçek ihaleler
  useEffect(() => {
    async function loadAuctions() {
      const { data, error } = await getActiveAuctions();
      if (!error && data && data.length > 0) {
        const mapped: SupabaseAuction[] = data.map((row, i) => ({
          id: row.id,
          current_bid: row.current_bid,
          start_price: row.start_price,
          bid_count: row.bid_count,
          end_time: row.end_time,
          bid_increment: row.bid_increment ?? 250,
          winner_id: row.winner_id,
          status: row.status,
          extended_count: row.extended_count ?? 0,
          products: row.products,
          lot: i + 1,
          viewerCount: Math.floor(Math.random() * 200) + 50,
          leaderName: null,
          leader: row.winner_id,
        }));
        setAuctions(mapped);
        setActiveAuctionId(mapped[0].id);
        setActiveAuction(mapped[0]);
      }
    }
    loadAuctions();
  }, []);

  // Aktif ihale seçildiğinde detaylarını çek
  const handleSelectAuction = useCallback(async (id: string) => {
    setActiveAuctionId(id);
    const found = auctions.find(a => a.id === id);
    if (found) setActiveAuction(found);

    // Gerçek ihale ise teklif geçmişiyle güncelle
    if (!id.startsWith('auc')) {
      const { auction } = await getAuctionWithBids(id);
      if (auction) {
        const updated: SupabaseAuction = {
          id: auction.id,
          current_bid: auction.current_bid,
          start_price: auction.start_price,
          bid_count: auction.bid_count,
          end_time: auction.end_time,
          bid_increment: auction.bid_increment ?? 250,
          winner_id: auction.winner_id,
          status: auction.status,
          extended_count: auction.extended_count ?? 0,
          products: (auction as Record<string, unknown>).products as SupabaseAuction['products'],
        };
        setActiveAuction(updated);
      }
    }
  }, [auctions]);

  // Aktif kullanıcı kaydı
  useEffect(() => {
    if (!user?.id) return;
    updateActiveUser(user.id);
    const iv = setInterval(() => updateActiveUser(user.id), 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [user?.id]);

  const handleAddToCart = useCallback((product: Product) => {
    setCartItems(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product, quantity: 1 }];
    });
  }, []);

  const handleUpdateQty = useCallback((productId: string, qty: number) => {
    if (qty <= 0) { setCartItems(prev => prev.filter(i => i.product.id !== productId)); }
    else { setCartItems(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: qty } : i)); }
  }, []);

  const handleRemove = useCallback((productId: string) => {
    setCartItems(prev => prev.filter(i => i.product.id !== productId));
  }, []);

  const handleOrderComplete = useCallback(() => {
    setCartItems([]); // Başarılı sipariş sonrası sepeti temizle
  }, []);

  const cartCount = cartItems.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="min-h-screen" style={{ background: '#0A0E1A' }}>
      <Header cartCount={cartCount} onCartToggle={() => setCartOpen(o => !o)} />

      <main className="max-w-[1600px] mx-auto px-4 py-5 space-y-6">
        {/* Stats Bar — platform_stats tablosundan (Realtime) */}
        <StatsBar />

        {/* Hero: Live Stream + Auction Panel */}
        <section className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-5">
          <LiveStream />
          <AuctionPanel
            key={activeAuctionId}
            auction={activeAuction}
            onBid={(id, amount) => {
              // Anlık: aktif ihaledeki current_bid'i güncelle
              setAuctions(prev => prev.map(a => a.id === id ? { ...a, current_bid: amount, bid_count: (a.bid_count ?? 0) + 1 } : a));
              if (activeAuction.id === id) setActiveAuction(prev => ({ ...prev, current_bid: amount }));
            }}
            onAuctionEnd={(id) => {
              setAuctions(prev => prev.map(a => a.id === id ? { ...a, status: 'ended' } : a));
            }}
          />
        </section>

        {/* Auction List — auctions tablosundan */}
        <AuctionList auctions={auctions} activeId={activeAuctionId} onSelect={handleSelectAuction} />

        {/* Leaderboard + Products */}
        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-5">
          <div className="hidden xl:block">
            {/* Leaderboard — seller_stats tablosundan (Realtime) */}
            <Leaderboard />
          </div>
          {/* ProductGrid — products tablosundan */}
          <ProductGrid onAddToCart={handleAddToCart} />
        </div>

        {/* Mobile Leaderboard */}
        <div className="xl:hidden">
          <Leaderboard />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#111827] py-6 px-4 text-center" style={{ background: '#070a12' }}>
        <div className="max-w-[1600px] mx-auto">
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mb-3">
            <a href="#" className="text-[#5E7090] hover:text-[#D4AF37] text-[11px] font-mono transition-colors">Hakkımızda</a>
            <a href="#" className="text-[#5E7090] hover:text-[#D4AF37] text-[11px] font-mono transition-colors">KVKK</a>
            <a href="#" className="text-[#5E7090] hover:text-[#D4AF37] text-[11px] font-mono transition-colors">Kullanım Şartları</a>
            <a href="#" className="text-[#5E7090] hover:text-[#D4AF37] text-[11px] font-mono transition-colors">Satıcı Rehberi</a>
            <a href="#" className="text-[#5E7090] hover:text-[#D4AF37] text-[11px] font-mono transition-colors">Komisyonlar</a>
            <a href="#" className="text-[#5E7090] hover:text-[#D4AF37] text-[11px] font-mono transition-colors">Escrow</a>
          </div>
          <p className="text-[#5E7090] font-mono text-[11px]">
            &copy; 2026 DampingVar Real-time Supabase Integrated Ecosystem. Tüm hakları saklıdır.
          </p>
        </div>
      </footer>

      {/* Cart Sidebar — orders + payments + escrow_wallets bağlı */}
      <CartSidebar
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cartItems}
        onUpdateQty={handleUpdateQty}
        onRemove={handleRemove}
        onOrderComplete={handleOrderComplete}
      />
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
// MODÜL 3.1: react-router-dom ile gerçek route tablosu. vercel.json zaten her
// bilinmeyen path'i index.html'e rewrite ediyor (SPA fallback), Vite dev
// server da aynısını yapıyor — BrowserRouter bu ortamların ikisiyle de uyumlu.
//
// NOT: /admin, /supplier, /franchise, /affiliate artık RequireRole ile
// korunuyor — auth yoksa "/" adresine, rol uymuyorsa 403 ekranına düşer.
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppInner />} />
          <Route path="/trade-signals" element={<TradeSignals />} />
          <Route path="/admin" element={<RequireRole allowedRoles={['admin']}><AdminPayments /></RequireRole>} />
          {/* /supplier ve /franchise KALDIRILDI — gerçek panelleri artık
              dashboard.html'de (public/modules/supplier.js, franchise.js).
              Bu route'lar dururken kullanıcı sahte "geliştirme aşamasında"
              ekranına düşüyordu; artık "*" fallback'i ile "/"e dönüyor. */}
          <Route path="/affiliate" element={<RequireRole allowedRoles={['influencer']}><ComingSoon title="Affiliate Paneli" /></RequireRole>} />
          {/* Tanımsız route → ana sayfaya geri dön */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
