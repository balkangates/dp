'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

const NAV = [
  { href: '/admin', label: 'Genel Bakış', icon: 'fa-gauge' },
  { href: '/admin/catalog', label: 'Katalog Onayı', icon: 'fa-box-check' },
  { href: '/admin/suggestions', label: 'Bayi Önerileri', icon: 'fa-lightbulb' },
  { href: '/admin/auctions', label: 'İhale Onayı', icon: 'fa-gavel' },
  { href: '/admin/finance', label: 'Muhasebe', icon: 'fa-coins' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  const pathname = usePathname();

  // middleware.ts zaten sunucu tarafında rol kontrolü yapıyor — bu sadece
  // client-side ekstra bir güvenlik/kullanıcı deneyimi katmanı.
  if (loading) return <div className="max-w-6xl mx-auto px-4 py-8 text-[#5E7090] font-mono text-sm">Yükleniyor…</div>;
  if (profile && profile.role !== 'admin') {
    return <div className="max-w-6xl mx-auto px-4 py-8 text-red-400 font-mono text-sm">Bu sayfaya erişim yetkiniz yok.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <nav className="flex gap-2 mb-6 border-b border-[#1E2A42] pb-3 overflow-x-auto no-scrollbar">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
            style={{
              background: pathname === n.href ? '#D4AF37' : 'transparent',
              color: pathname === n.href ? '#000' : '#5E7090',
            }}
          >
            <i className={`fas ${n.icon}`} /> {n.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
