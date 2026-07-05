import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { signIn, signUp, resetPassword } from '../lib/supabase';

type ModalMode = 'login' | 'register' | 'forgot';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: ModalMode;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AuthModal({ isOpen, initialMode = 'login', onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<ModalMode>(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // initialMode değişince formu sıfırla
  useEffect(() => {
    if (isOpen) { setMode(initialMode); resetForm(); }
  }, [initialMode, isOpen]);

  const resetForm = () => {
    setEmail(''); setPassword(''); setFullName(''); setConfirmPassword('');
    setError(''); setSuccess('');
  };
  const switchMode = (m: ModalMode) => { resetForm(); setMode(m); };

  // ─── GİRİŞ ───────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await signIn(email, password);

    if (error) {
      if (error.message.includes('Invalid login')) {
        setError('E-posta veya şifre hatalı.');
      } else if (error.message.includes('Email not confirmed')) {
        setError('E-posta adresinizi doğrulamadınız. Gelen kutunuzu kontrol edin.');
      } else if (error.message.includes('Too many requests')) {
        setError('Çok fazla deneme. Lütfen bekleyin.');
      } else {
        setError('Giriş yapılamadı: ' + error.message);
      }
      setLoading(false);
      return;
    }

    // ✅ Başarılı: önce modal kapat, sonra yönlendir
    // onAuthStateChange YOK — tek kaynak burası
    onClose();
    onSuccess(); // Header'daki yönlendirme burada tetiklenir
    // loading sıfırlanmaz — sayfa zaten değişecek
  };

  // ─── KAYIT ───────────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    if (password !== confirmPassword) { setError('Şifreler eşleşmiyor.'); setLoading(false); return; }
    if (password.length < 6) { setError('Şifre en az 6 karakter olmalıdır.'); setLoading(false); return; }

    const { error } = await signUp(email, password, fullName);
    if (error) {
      setError(error.message.includes('already registered')
        ? 'Bu e-posta zaten kayıtlı. Giriş yapmayı deneyin.'
        : 'Kayıt hatası: ' + error.message);
    } else {
      setSuccess('Kayıt başarılı! E-postanızı doğruladıktan sonra giriş yapabilirsiniz.');
      setTimeout(() => switchMode('login'), 3000);
    }
    setLoading(false);
  };

  // ─── ŞİFRE SIFIRLA ───────────────────────────────────────────────
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await resetPassword(email);
    if (error) { setError('Gönderim hatası: ' + error.message); }
    else { setSuccess('Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.'); }
    setLoading(false);
  };

  const titles: Record<ModalMode, string> = { login: 'Giriş Yap', register: 'Kayıt Ol', forgot: 'Şifremi Unuttum' };
  const icons: Record<ModalMode, string> = { login: 'fas fa-sign-in-alt', register: 'fas fa-user-plus', forgot: 'fas fa-key' };

  if (!isOpen) return null;

  const inputCls = 'w-full bg-[#070b14] border border-[#2A3650] rounded-xl px-4 py-3 text-white font-mono text-sm placeholder-[#3A4A65] focus:outline-none focus:border-[#D4AF37]/60 transition-all';
  const labelCls = 'text-[#8A9BB5] text-[11px] font-mono font-bold tracking-widest mb-2 block';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 24 }}
          transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          className="relative w-full max-w-[420px] rounded-2xl border border-[#2A3650] overflow-hidden"
          style={{ background: '#0B1220', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
        >
          <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#D4AF37,#F5D76E,#D4AF37)' }} />
          <div className="p-8">
            <button onClick={onClose}
              className="absolute top-5 right-5 w-8 h-8 rounded-lg flex items-center justify-center text-[#5E7090] hover:text-white hover:bg-[#1a2540] transition-all">
              <i className="fas fa-times text-sm"></i>
            </button>

            {/* Logo */}
            <div className="text-center mb-7">
              <span className="text-2xl font-black tracking-tighter text-white">DAMPING<span className="text-[#D4AF37]">VAR</span></span>
              <p className="text-[#4A5E7A] text-[11px] font-mono tracking-widest uppercase mt-1">B2B Platformu</p>
            </div>

            {/* Başlık */}
            <div className="flex items-center justify-center gap-2.5 mb-7">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(212,175,55,0.12)' }}>
                <i className={`${icons[mode]} text-[#D4AF37] text-sm`}></i>
              </div>
              <h2 className="text-white font-extrabold text-lg">{titles[mode]}</h2>
            </div>

            {/* Alert */}
            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-mono flex items-start gap-2.5">
                <i className="fas fa-exclamation-triangle mt-0.5 shrink-0"></i><span>{error}</span>
              </div>
            )}
            {success && (
              <div className="mb-5 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-mono flex items-start gap-2.5">
                <i className="fas fa-check-circle mt-0.5 shrink-0"></i><span>{success}</span>
              </div>
            )}

            {/* ── GİRİŞ ── */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-5">
                <div><label className={labelCls}>E-POSTA ADRESİ</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ornek@sirket.com" required className={inputCls} /></div>
                <div><label className={labelCls}>ŞİFRE</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required className={inputCls} /></div>
                <button type="submit" disabled={loading}
                  className="w-full py-3.5 rounded-xl font-black text-black text-sm cursor-pointer hover:opacity-90 disabled:opacity-50 mt-2"
                  style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)' }}>
                  {loading ? <><i className="fas fa-spinner fa-spin mr-2"></i>Giriş yapılıyor...</> : <><i className="fas fa-sign-in-alt mr-2"></i>GİRİŞ YAP</>}
                </button>
              </form>
            )}

            {/* ── KAYIT ── */}
            {mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-5">
                <div><label className={labelCls}>AD SOYAD / FİRMA ADI</label>
                  <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Adınız veya Firma Adı" required className={inputCls} /></div>
                <div><label className={labelCls}>E-POSTA ADRESİ</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ornek@sirket.com" required className={inputCls} /></div>
                <div><label className={labelCls}>ŞİFRE</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="En az 6 karakter" required className={inputCls} /></div>
                <div><label className={labelCls}>ŞİFRE TEKRAR</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" required className={inputCls} /></div>
                <button type="submit" disabled={loading}
                  className="w-full py-3.5 rounded-xl font-black text-black text-sm cursor-pointer hover:opacity-90 disabled:opacity-50 mt-2"
                  style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)' }}>
                  {loading ? <><i className="fas fa-spinner fa-spin mr-2"></i>Kayıt yapılıyor...</> : <><i className="fas fa-user-plus mr-2"></i>KAYIT OL</>}
                </button>
              </form>
            )}

            {/* ── ŞİFREMİ UNUTTUM ── */}
            {mode === 'forgot' && (
              <form onSubmit={handleForgot} className="space-y-5">
                <div className="px-4 py-3.5 rounded-xl bg-[#0D1830] border border-[#1E3050] text-[#6A8AB0] text-xs font-mono">
                  <i className="fas fa-info-circle text-[#38BDF8] mr-2"></i>
                  E-posta adresinizi girin, şifre sıfırlama bağlantısı gönderelim.
                </div>
                <div><label className={labelCls}>E-POSTA ADRESİ</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ornek@sirket.com" required className={inputCls} /></div>
                <button type="submit" disabled={loading}
                  className="w-full py-3.5 rounded-xl font-black text-black text-sm cursor-pointer hover:opacity-90 disabled:opacity-50 mt-2"
                  style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)' }}>
                  {loading ? <><i className="fas fa-spinner fa-spin mr-2"></i>Gönderiliyor...</> : <><i className="fas fa-paper-plane mr-2"></i>BAĞLANTI GÖNDER</>}
                </button>
              </form>
            )}

            {/* Alt linkler */}
            <div className="mt-6 pt-5 border-t border-[#1A2540] flex flex-col items-center gap-3 text-xs font-mono">
              {mode === 'login' && (<>
                <button onClick={() => switchMode('forgot')} className="text-[#D4AF37] hover:underline">
                  <i className="fas fa-key mr-1.5 text-[10px]"></i>Şifremi Unuttum
                </button>
                <span className="text-[#4A5E7A]">Hesabınız yok mu?{' '}
                  <button onClick={() => switchMode('register')} className="text-[#38BDF8] hover:underline font-bold">Kayıt Ol</button>
                </span>
              </>)}
              {mode === 'register' && (
                <span className="text-[#4A5E7A]">Zaten hesabınız var mı?{' '}
                  <button onClick={() => switchMode('login')} className="text-[#38BDF8] hover:underline font-bold">Giriş Yap</button>
                </span>
              )}
              {mode === 'forgot' && (
                <button onClick={() => switchMode('login')} className="text-[#38BDF8] hover:underline">
                  <i className="fas fa-arrow-left mr-1.5 text-[10px]"></i>Giriş sayfasına dön
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
