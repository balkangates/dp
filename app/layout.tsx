import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthProvider } from '@/components/AuthProvider';
import HeaderAuthStatus from '@/components/HeaderAuthStatus';
import './globals.css';

export const metadata: Metadata = {
  title: 'DampingVar | Hırdavat & İnşaat Malzemeleri B2B Platformu',
  description: 'Canlı yayında toptan hırdavat/inşaat malzemesi alım-satımı.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
      </head>
      <body className="bg-[#0A0E1A] text-[#A3B3D1]">
        <AuthProvider>
          <header className="border-b border-[#1E2A42] sticky top-0 z-30 bg-[#0A0E1A]/95 backdrop-blur">
            <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
              <Link href="/" className="text-white font-black tracking-tight">
                DAMPING<span style={{ color: '#D4AF37' }}>VAR</span>
              </Link>
              <HeaderAuthStatus />
            </div>
          </header>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
