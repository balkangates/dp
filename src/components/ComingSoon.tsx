/**
 * ComingSoon.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * MODÜL 3.1 — geçici fallback.
 * SupplierPanel / FranchisePanel / AffiliatePanel şu an derlenemiyor
 * (SupplierPanel & FranchisePanel → eksik '../lib/dampingvar';
 *  AffiliatePanel → eksik getReferralData/ensureReferralCode exportları).
 * Route'lar burada kuruluyor ki mimari hazır olsun; gerçek panel dosyaları
 * MODÜL 3.2'de (lib/dampingvar.ts + eksik supabase.ts fonksiyonları yazılınca)
 * bu fallback'in yerine geçecek. Bilerek SupplierPanel/FranchisePanel/
 * AffiliatePanel import EDİLMİYOR — aksi halde build kırılır.
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
