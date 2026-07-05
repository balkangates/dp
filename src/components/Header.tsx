import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { signOut } from '../lib/supabase';
import AuthModal from './AuthModal';

// MODÜL 3.1 — role → React route eşlemesi.
// Karşılığı olmayan roller (customer/dealer/logistics/finance) henüz
// React tarafında panele sahip değil; onlar için MEVCUT davranış korunuyor
// (dashboard.html'e yönlendirme) — bu, "çalışan sistemi kırma" kuralı gereği.
// DÜZELTME: 'supplier' ve 'franchise' buradan ÇIKARILDI. Gerçek panelleri
// artık dashboard.html'de (public/modules/supplier.js, franchise.js) —
// React tarafındaki karşılıkları hâlâ boş ComingSoon placeholder'ı. Bu
// eşleme dururken supplier/franchise kullanıcıları yanlışlıkla "yakında
// aktif olacak" sahte ekranına düşüyordu; şimdi diğer roller (buyer/seller/
// logistics/finance) gibi doğrudan dashboard.html'e gidiyorlar.
const ROLE_ROUTES: Record<string, string> = {
  admin: '/admin',
  influencer: '/affiliate',
};

interface HeaderProps {
  cartCount: number;
  onCartToggle: () => void;
}

const tickerItems = [
  { symbol: 'LOT#1', text: 'Apple Watch Ultra', change: '+₺250', up: true },
  { symbol: 'LOT#2', text: 'Rolex Datejust', change: '+₺2.500', up: true },
  { symbol: 'LOT#3', text: 'iPhone 15 Pro x50', change: '+₺10.000', up: true },
  { symbol: 'DAMPING', text: 'Yeni ürünler eklendi', change: '🔥', up: true },
  { symbol: 'B2B', text: 'Toptan fırsatlar', change: '📦', up: true },
];

type AuthModalMode = 'login' | 'register' | 'forgot';

export default function Header({ cartCount, onCartToggle }: HeaderProps) {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [activeViewers, setActiveViewers] = useState(3847);
  const [tickerOffset, setTickerOffset] = useState(0);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthModalMode>('login');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      setActiveViewers(v => v + Math.floor(Math.random() * 10) - 4);
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setTickerOffset(o => o - 1);
    }, 30);
    return () => clearInterval(iv);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openAuth = (mode: AuthModalMode) => {
    setAuthMode(mode);
    setAuthModalOpen(true);
    setDropdownOpen(false);
  };

  // LiveStream'den gelen 'openAuthModal' event'ini dinle
  useEffect(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent).detail as AuthModalMode ?? 'login';
      openAuth(mode);
    };
    document.addEventListener('openAuthModal', handler);
    return () => document.removeEventListener('openAuthModal', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    setDropdownOpen(false);
    await signOut();
  };

  const handleDashboard = () => {
    setDropdownOpen(false);
    const reactRoute = profile?.role ? ROLE_ROUTES[profile.role] : undefined;

    if (reactRoute) {
      // admin / supplier / franchise / influencer → yeni React route'u (SPA içi, reload yok)
      navigate(reactRoute);
      return;
    }

    // customer / dealer / logistics / finance → henüz React karşılığı
    // yok, MEVCUT davranış korunuyor: legacy dashboard.html'e tam sayfa geçiş.
    window.location.href = window.location.hostname.includes('dampingvar.com.tr')
      ? 'https://www.dampingvar.com.tr/dashboard.html'
      : `${window.location.origin}/dashboard.html`;
  };

  // Display name
  const displayName = profile?.full_name || profile?.company_name || user?.email?.split('@')[0] || 'Kullanıcı';
  const roleLabels: Record<string, string> = {
    customer: 'Müşteri',      // eski adı 'buyer'
    dealer: 'Bayi',           // eski adı 'seller'
    admin: 'Yönetici',
    supplier: 'Tedarikçi',
    influencer: 'Influencer',
    logistics: 'Lojistik',
    finance: 'Finans',
    franchise: 'Franchise',
  };

  return (
    <>
      <header className="sticky top-0 z-50 backdrop-blur-xl" style={{ background: 'rgba(10,14,26,0.95)', borderBottom: '1px solid rgba(212,175,55,0.3)' }}>
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tighter text-white">
                DAMPING<span className="text-[#D4AF37]">VAR</span>
              </span>
              <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-white rounded-full live-dot"></span>
                LIVE
              </span>
            </div>
            <div className="hidden md:flex items-center gap-1 bg-[#090d16] rounded-full px-3 py-1 border border-[#2A3650]">
              <i className="fas fa-eye text-[#38BDF8] text-[10px]"></i>
              <span className="text-[11px] font-mono font-bold text-[#10B981]">{activeViewers.toLocaleString('tr-TR')}</span>
              <span className="text-[10px] text-[#5E7090]">izleyici</span>
            </div>
          </div>

          {/* Ticker */}
          <div className="hidden lg:block flex-1 max-w-xl overflow-hidden bg-[#090d16] rounded-full border border-[#2A3650] px-4 py-1.5">
            <div className="flex gap-8 whitespace-nowrap" style={{ transform: `translateX(${tickerOffset}px)` }}>
              {[...tickerItems, ...tickerItems, ...tickerItems].map((item, i) => (
                <span key={i} className="inline-flex items-center gap-2 text-[11px] font-mono">
                  <span className="text-[#D4AF37] font-bold">{item.symbol}</span>
                  <span className="text-[#5E7090]">{item.text}</span>
                  <span className={item.up ? 'text-[#10B981] font-bold' : 'text-red-500 font-bold'}>{item.change}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Sepet */}
            <button
              onClick={onCartToggle}
              className="relative flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs font-black cursor-pointer transition-all btn-glow"
              style={{ background: 'linear-gradient(135deg, #D4AF37, #F5D76E)', color: '#000' }}
            >
              <i className="fas fa-shopping-bag"></i>
              <span className="hidden sm:inline">SEPETİM</span>
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold badge-bounce">
                  {cartCount}
                </span>
              )}
            </button>

            {/* Auth Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(o => !o)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#2A3650] bg-[#090d16] text-[#A3B3D1] hover:border-[#D4AF37]/50 hover:text-white transition-all font-mono text-xs font-bold cursor-pointer"
              >
                {!loading && user ? (
                  <>
                    <div className="w-6 h-6 rounded-full bg-[#D4AF37] flex items-center justify-center text-black text-[10px] font-black">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <span className="hidden sm:inline max-w-[100px] truncate">{displayName}</span>
                    <i className={`fas fa-chevron-${dropdownOpen ? 'up' : 'down'} text-[10px]`}></i>
                  </>
                ) : (
                  <>
                    <i className="fas fa-user-circle text-[#D4AF37]"></i>
                    <span className="hidden sm:inline">HESAP</span>
                    <i className={`fas fa-chevron-${dropdownOpen ? 'up' : 'down'} text-[10px]`}></i>
                  </>
                )}
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[#2A3650] overflow-hidden z-50"
                    style={{ background: '#0D1525', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                  >
                    {user ? (
                      /* Giriş yapılmış */
                      <>
                        {/* Kullanıcı bilgisi */}
                        <div className="px-4 py-3 border-b border-[#2A3650]">
                          <p className="text-white font-bold text-sm truncate">{displayName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#D4AF37]/15 text-[#D4AF37]">
                              {roleLabels[profile?.role || 'customer'] || profile?.role}
                            </span>
                            {profile?.balance !== undefined && (
                              <span className="text-[10px] font-mono text-[#10B981]">
                                ₺{Number(profile.balance).toLocaleString('tr-TR')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Dashboard linki */}
                        <button
                          onClick={handleDashboard}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-[#A3B3D1] hover:bg-[#131C2C] hover:text-white transition-colors text-xs font-mono cursor-pointer"
                        >
                          <i className="fas fa-tachometer-alt text-[#38BDF8] w-4 text-center"></i>
                          Panel (Dashboard)
                        </button>

                        <div className="h-px bg-[#2A3650] mx-3 my-1"></div>

                        {/* Çıkış */}
                        <button
                          onClick={handleSignOut}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors text-xs font-mono cursor-pointer"
                        >
                          <i className="fas fa-sign-out-alt w-4 text-center"></i>
                          Çıkış Yap
                        </button>
                      </>
                    ) : (
                      /* Giriş yapılmamış */
                      <>
                        <button
                          onClick={() => openAuth('login')}
                          className="w-full flex items-center gap-3 px-4 py-3 text-[#A3B3D1] hover:bg-[#131C2C] hover:text-white transition-colors text-xs font-mono cursor-pointer"
                        >
                          <i className="fas fa-sign-in-alt text-[#D4AF37] w-4 text-center"></i>
                          Giriş Yap
                        </button>
                        <button
                          onClick={() => openAuth('register')}
                          className="w-full flex items-center gap-3 px-4 py-3 text-[#A3B3D1] hover:bg-[#131C2C] hover:text-white transition-colors text-xs font-mono cursor-pointer"
                        >
                          <i className="fas fa-user-plus text-[#10B981] w-4 text-center"></i>
                          Kayıt Ol
                        </button>
                        <div className="h-px bg-[#2A3650] mx-3 my-1"></div>
                        <button
                          onClick={() => openAuth('forgot')}
                          className="w-full flex items-center gap-3 px-4 py-3 text-[#5E7090] hover:bg-[#131C2C] hover:text-[#A3B3D1] transition-colors text-xs font-mono cursor-pointer"
                        >
                          <i className="fas fa-key text-[#5E7090] w-4 text-center"></i>
                          Şifremi Unuttum
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authMode}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => {
          // AuthModal kendi kendini kapattı (onClose çağrıldı)
          // Supabase session'ın localStorage'a yazılması için kısa bekle
          setTimeout(() => {
            window.location.href = window.location.hostname.includes('dampingvar.com.tr')
              ? 'https://www.dampingvar.com.tr/dashboard.html'
              : `${window.location.origin}/dashboard.html`;
          }, 150);
        }}
      />
    </>
  );
}
