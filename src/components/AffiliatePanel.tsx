/**
 * AffiliatePanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Affiliate (yeni eklenen rol) dashboard: kendi referans kodunu gösterir,
 * onunla kayıt olmuş kullanıcıları listeler. Kazanç/komisyon hesaplaması
 * bu platformda henüz mevcut değil (ne DB'de ne backend'de bir komisyon
 * mekanizması vardı) — bu panel yalnızca auth/rol/register kapsamındaki
 * minimum çalışır deneyimi sağlar. Komisyon oranı, ödeme takibi vs.
 * ayrı bir iş kapsamıdır.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getReferralData, ensureReferralCode, type ReferredUser } from '../lib/supabase';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

export default function AffiliatePanel() {
  const { user, loading: authLoading } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [referred, setReferred] = useState<ReferredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let { referralCode, referred: list } = await getReferralData(user.id);
    if (!referralCode) {
      const created = await ensureReferralCode(user.id);
      referralCode = created.referralCode;
    }
    setCode(referralCode);
    setReferred(list);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading || loading) {
    return <div className="text-[#5E7090] font-mono text-sm py-10 text-center">Yükleniyor…</div>;
  }

  const referralLink = code ? `${window.location.origin}/?ref=${code}` : '';

  const handleCopy = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">Affiliate Paneli</h1>
        <p className="text-[#5E7090] font-mono text-sm mt-1">Referans linkinizi paylaşın, kayıt olanları takip edin.</p>
      </div>

      <div className="rounded-2xl p-6" style={CARD}>
        <p className="text-[#8A9BB5] text-[11px] font-mono font-bold tracking-widest mb-3">REFERANS LİNKİNİZ</p>
        <div className="flex items-center gap-3 flex-wrap">
          <code className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[#070b14] border border-[#2A3650] text-[#D4AF37] text-sm font-mono truncate">
            {referralLink || '—'}
          </code>
          <button
            onClick={handleCopy}
            className="px-4 py-3 rounded-xl font-bold text-black text-sm cursor-pointer hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)' }}
          >
            <i className={`fas ${copied ? 'fa-check' : 'fa-copy'} mr-2`}></i>
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl p-6" style={CARD}>
        <p className="text-[#8A9BB5] text-[11px] font-mono font-bold tracking-widest mb-4">
          REFERANSLARINIZ ({referred.length})
        </p>
        {referred.length === 0 ? (
          <p className="text-[#5E7090] font-mono text-sm text-center py-8">
            Henüz referans linkinizle kayıt olan kimse yok.
          </p>
        ) : (
          <div className="space-y-2">
            {referred.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#070b14] border border-[#1A2540]">
                <div>
                  <p className="text-white text-sm font-bold">{r.full_name || r.email || 'Kullanıcı'}</p>
                  <p className="text-[#5E7090] text-[11px] font-mono">{new Date(r.created_at).toLocaleDateString('tr-TR')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
