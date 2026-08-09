'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase, getProfile } from '@/lib/supabase';
import { roleHome } from '@/lib/roles';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }

    // middleware.ts, ?redirectTo ile buraya bir kullanıcıyı yetkisiz bir
    // rotadan geri yolladıysa (ör. çıkış yapılmış bir sekmede /dealer/live
    // açıkken oturum düştüyse) girişten sonra onu KALDIĞI yere geri
    // götürüyoruz. Aksi halde — yani kullanıcı doğrudan /login'e geldiyse —
    // rolüne göre doğru panele (bayi → canlı satış, tedarikçi → tedarikçi
    // paneli, admin → yönetim, lojistik → sevkiyatlar, müşteri → ana sayfa)
    // yönlendiriyoruz; herkesi '/' 'e atıp panelini kendi bulmasını
    // beklemek yerine.
    const redirectTo = params.get('redirectTo');
    if (redirectTo) {
      router.push(redirectTo);
    } else {
      const { data: profile } = await getProfile(data.user.id);
      router.push(roleHome(profile?.role));
    }
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4">
      <h1 className="text-white font-black text-2xl">Giriş Yap</h1>
      <input
        type="email"
        placeholder="E-posta"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full bg-black/30 border border-[#2A3650] rounded-lg px-3 py-2.5 text-sm text-white"
      />
      <input
        type="password"
        placeholder="Şifre"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full bg-black/30 border border-[#2A3650] rounded-lg px-3 py-2.5 text-sm text-white"
      />
      {error && <p className="text-red-400 text-xs font-mono">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg py-2.5 text-sm font-extrabold"
        style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? '…' : 'Giriş Yap'}
      </button>
      <p className="text-[#5E7090] text-xs font-mono text-center">
        Hesabın yok mu? <Link href="/register" className="text-[#D4AF37]">Kayıt ol</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
