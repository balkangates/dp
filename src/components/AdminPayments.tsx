/**
 * AdminPayments.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin paneli — bekleyen USDT ödemelerini listeler ve onaylar / reddeder.
 *
 * Mevcut dashboard'a entegrasyon:
 *   1. Menüye "Kripto Ödemeler" ekleyin (role=admin)
 *   2. navigateTo / route ile buraya yönlendirin
 *
 * Onay akışı:
 *   Admin "Onayla" → trade_payments.status = 'confirmed'
 *   → Supabase trigger on_payment_confirmed() otomatik subscription aktifler
 *   → Kullanıcı Realtime ile anında haberdar edilir
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface Payment {
  id:             string;
  user_id:        string;
  plan:           'PRO' | 'VIP';
  amount_usdt:    number;
  tx_hash:        string | null;
  memo:           string | null;
  status:         'pending' | 'confirmed' | 'failed';
  created_at:     string;
  confirmed_at:   string | null;
  notes:          string | null;
  // joined
  user_email?:    string;
  user_name?:     string;
}

const STATUS_META = {
  pending:   { label: '⏳ Bekliyor',   color: '#F59E0B', bg: 'rgba(245,158,11,.12)'  },
  confirmed: { label: '✅ Onaylandı',  color: '#10B981', bg: 'rgba(16,185,129,.12)'  },
  failed:    { label: '❌ Reddedildi', color: '#EF4444', bg: 'rgba(239,68,68,.12)'   },
};

const PLAN_COLOR = { PRO: '#38BDF8', VIP: '#D4AF37' };

export default function AdminPayments() {
  const { user } = useAuth();
  const [payments,    setPayments]    = useState<Payment[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [actionId,    setActionId]    = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all'|'pending'|'confirmed'|'failed'>('pending');
  const [notes,       setNotes]       = useState<Record<string, string>>({});
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = supabase
      .from('trade_payments')
      .select(`
        id, user_id, plan, amount_usdt, tx_hash, memo,
        status, created_at, confirmed_at, notes,
        profiles!trade_payments_uid_fk ( full_name, email )
      `)
      .order('created_at', { ascending: false });

    if (filterStatus !== 'all') q.eq('status', filterStatus);

    const { data, error } = await q;
    if (error) { console.error(error); setLoading(false); return; }

    setPayments((data ?? []).map((r: any) => ({
      ...r,
      user_email: r.profiles?.email,
      user_name:  r.profiles?.full_name,
    })));
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  // Realtime: yeni ödeme gelince otomatik yükle
  useEffect(() => {
    const ch = supabase
      .channel('admin-trade-payments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_payments' },
        () => load())
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [load]);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  async function updateStatus(id: string, status: 'confirmed' | 'failed') {
    setActionId(id);
    const { error } = await supabase
      .from('trade_payments')
      .update({
        status,
        confirmed_by:  status === 'confirmed' ? user?.id : null,
        confirmed_at:  status === 'confirmed' ? new Date().toISOString() : null,
        notes:         notes[id] || null,
        updated_at:    new Date().toISOString(),
      })
      .eq('id', id);

    setActionId(null);
    if (error) { showToast('Hata: ' + error.message, false); return; }
    showToast(
      status === 'confirmed' ? '✅ Ödeme onaylandı, abonelik aktifleştirildi.' : '❌ Ödeme reddedildi.',
      status === 'confirmed',
    );
    load();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const pending = payments.filter(p => p.status === 'pending').length;

  return (
    <div style={{ fontFamily: "'Segoe UI',system-ui,sans-serif", color: '#E2E8F0' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 999,
          background: toast.ok ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)',
          border: `1px solid ${toast.ok ? 'rgba(16,185,129,.4)' : 'rgba(239,68,68,.4)'}`,
          color: toast.ok ? '#10B981' : '#EF4444',
          borderRadius: 12, padding: '12px 18px', fontSize: 13, fontWeight: 700,
          backdropFilter: 'blur(8px)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#D4AF37' }}>💳</span> Kripto Ödemeler
            {pending > 0 && (
              <span style={{
                background: 'rgba(245,158,11,.2)', color: '#F59E0B',
                border: '1px solid rgba(245,158,11,.4)',
                borderRadius: 20, fontSize: 11, padding: '2px 9px', fontFamily: 'monospace',
              }}>
                {pending} bekliyor
              </span>
            )}
          </h2>
          <p style={{ fontSize: 11, color: '#5E7090', fontFamily: 'monospace', marginTop: 2 }}>
            Onayladığınızda kullanıcı aboneliği otomatik aktifleşir.
          </p>
        </div>
        <button onClick={load}
          style={{ background: '#131C2C', border: '1px solid #2A3650', color: '#A3B3D1', borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>
          ⟳ Yenile
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['all', 'pending', 'confirmed', 'failed'] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'monospace',
            border: `1px solid ${filterStatus === s ? '#D4AF37' : '#2A3650'}`,
            background: filterStatus === s ? '#D4AF37' : '#131C2C',
            color: filterStatus === s ? '#000' : '#5E7090',
          }}>
            {{ all: 'Tümü', pending: '⏳ Bekliyor', confirmed: '✅ Onaylı', failed: '❌ Reddedildi' }[s]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: '#131C2C', border: '1px solid #2A3650', borderRadius: 14, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#5E7090', fontFamily: 'monospace', fontSize: 12 }}>
            Yükleniyor...
          </div>
        ) : payments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#5E7090', fontFamily: 'monospace', fontSize: 12 }}>
            Bu kategoride ödeme yok.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Kullanıcı','Plan','Miktar','MEMO','TX Hash','Durum','Tarih','İşlem'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '10px 14px',
                      background: 'rgba(42,54,80,.5)', color: '#5E7090',
                      fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const sm   = STATUS_META[p.status];
                  const busy = actionId === p.id;
                  return (
                    <tr key={p.id} style={{ borderTop: '1px solid rgba(42,54,80,.4)' }}>
                      {/* User */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{p.user_name || '—'}</div>
                        <div style={{ fontSize: 10, color: '#5E7090', fontFamily: 'monospace' }}>{p.user_email || p.user_id.slice(0,8)+'...'}</div>
                      </td>
                      {/* Plan */}
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          color: PLAN_COLOR[p.plan],
                          fontFamily: 'monospace', fontWeight: 900, fontSize: 12,
                        }}>{p.plan}</span>
                      </td>
                      {/* Amount */}
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 700 }}>
                        {p.amount_usdt} USDT
                      </td>
                      {/* MEMO */}
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          background: 'rgba(212,175,55,.1)', color: '#D4AF37',
                          border: '1px solid rgba(212,175,55,.3)',
                          borderRadius: 6, padding: '2px 8px',
                          fontFamily: 'monospace', fontWeight: 900, fontSize: 13,
                          letterSpacing: 2,
                        }}>
                          {p.memo || '—'}
                        </span>
                      </td>
                      {/* TX Hash */}
                      <td style={{ padding: '10px 14px', maxWidth: 160 }}>
                        {p.tx_hash ? (
                          <span style={{
                            fontFamily: 'monospace', fontSize: 10, color: '#A3B3D1',
                            wordBreak: 'break-all', display: 'block',
                          }} title={p.tx_hash}>
                            {p.tx_hash.slice(0, 16)}…{p.tx_hash.slice(-8)}
                          </span>
                        ) : <span style={{ color: '#5E7090' }}>—</span>}
                      </td>
                      {/* Status */}
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          background: sm.bg, color: sm.color,
                          border: `1px solid ${sm.color}40`,
                          borderRadius: 20, padding: '3px 9px',
                          fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}>
                          {sm.label}
                        </span>
                      </td>
                      {/* Date */}
                      <td style={{ padding: '10px 14px', color: '#5E7090', fontFamily: 'monospace', fontSize: 10, whiteSpace: 'nowrap' }}>
                        {new Date(p.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      {/* Actions */}
                      <td style={{ padding: '10px 14px' }}>
                        {p.status === 'pending' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {/* Notes input */}
                            <input
                              placeholder="Not (opsiyonel)"
                              value={notes[p.id] || ''}
                              onChange={e => setNotes(n => ({ ...n, [p.id]: e.target.value }))}
                              style={{
                                background: '#0D1525', border: '1px solid #2A3650',
                                borderRadius: 6, padding: '4px 8px', color: '#A3B3D1',
                                fontSize: 11, fontFamily: 'monospace', outline: 'none',
                                width: 140,
                              }}
                            />
                            <div style={{ display: 'flex', gap: 5 }}>
                              <button
                                onClick={() => updateStatus(p.id, 'confirmed')}
                                disabled={busy}
                                style={{
                                  background: 'rgba(16,185,129,.15)', color: '#10B981',
                                  border: '1px solid rgba(16,185,129,.35)',
                                  borderRadius: 7, padding: '5px 10px', fontSize: 11,
                                  fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
                                  opacity: busy ? .6 : 1, fontFamily: 'monospace',
                                }}
                              >
                                {busy ? '...' : '✓ Onayla'}
                              </button>
                              <button
                                onClick={() => updateStatus(p.id, 'failed')}
                                disabled={busy}
                                style={{
                                  background: 'rgba(239,68,68,.1)', color: '#EF4444',
                                  border: '1px solid rgba(239,68,68,.3)',
                                  borderRadius: 7, padding: '5px 10px', fontSize: 11,
                                  fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
                                  opacity: busy ? .6 : 1, fontFamily: 'monospace',
                                }}
                              >
                                ✕ Reddet
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#5E7090', fontSize: 11, fontFamily: 'monospace' }}>
                            {p.status === 'confirmed' && p.confirmed_at
                              ? new Date(p.confirmed_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
                              : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
