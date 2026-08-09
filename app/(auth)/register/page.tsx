'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Not: profiles satırı, auth.users INSERT'ine bağlı bir DB trigger'ı ile
    // otomatik oluşuyor (varsayılan role='customer'). Bayi/tedarikçi olarak
    // kayıt, mevcut sistemde ayrı bir başvuru akışından geçiyor (bkz.
    // dashboard.html) — bu form şimdilik sadece müşteri kaydı içindir.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-white font-black text-2xl">Kayıt Ol</h1>
        <input
          type="text"
          placeholder="Ad Soyad"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full bg-black/30 border border-[#2A3650] rounded-lg px-3 py-2.5 text-sm text-white"
        />
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
          minLength={6}
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
          {busy ? '…' : 'Kayıt Ol'}
        </button>
        <p className="text-[#5E7090] text-xs font-mono text-center">
          Zaten hesabın var mı? <Link href="/login" className="text-[#D4AF37]">Giriş yap</Link>
        </p>
      </form>
    </main>
  );
}
