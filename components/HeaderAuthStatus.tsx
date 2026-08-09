'use client';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { supabase } from '@/lib/supabase';

const ROLE_HOME: Record<string, string> = {
  dealer: '/dealer/live',
  supplier: '/supplier/catalog',
  admin: '/admin',
  logistics: '/logistics/dashboard',
};

export default function HeaderAuthStatus() {
  const { user, profile, loading } = useAuth();

  if (loading) return null;

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-xs font-bold px-3 py-1.5 rounded-lg"
        style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000' }}
      >
        Giriş Yap
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 text-xs font-mono">
      {profile?.role && profile.role !== 'customer' && (
        <Link href={ROLE_HOME[profile.role] ?? '/'} className="text-[#D4AF37]">
          Panele Git
        </Link>
      )}
      <span className="text-[#5E7090]">{profile?.full_name ?? user.email}</span>
      <button onClick={() => supabase.auth.signOut()} className="text-[#5E7090] hover:text-white">
        Çıkış
      </button>
    </div>
  );
}
