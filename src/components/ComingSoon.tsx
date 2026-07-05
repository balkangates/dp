/**
 * ComingSoon.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * MODÜL 3.1 — geçici fallback.
 * SupplierPanel.tsx / FranchisePanel.tsx / AffiliatePanel.tsx / CustomerHome.tsx
 * TEMİZLİK turunda SİLİNDİ (ölü kod — hiçbir yerden import edilmiyordu ve
 * '../lib/dampingvar' / eksik supabase.ts export'larına bağımlı oldukları
 * için derlenemiyorlardı). Bu React panellerin geleceği artık dashboard.html
 * modül sistemi (bkz. public/modules/live-sales.js, supplier.js, franchise.js)
 * — React tarafında gerçek bir karşılığı inşa edilirse buradaki route'lar o
 * zaman gerçek componentlerle değiştirilir.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="max-w-[1600px] mx-auto px-4 py-16">
      <div className="rounded-2xl p-10 text-center" style={CARD}>
        <i className="fas fa-tools text-3xl text-[#D4AF37] mb-4"></i>
        <h1 className="text-xl font-black text-white mb-2">{title}</h1>
        <p className="text-[#5E7090] font-mono text-sm">
          Bu panel şu anda geliştirme aşamasında. Yakında aktif olacak.
        </p>
      </div>
    </div>
  );
}
