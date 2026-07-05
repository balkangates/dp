/**
 * TradeSignals.tsx  —  PRODUCTION INTEGRATION EDITION
 * ─────────────────────────────────────────────────────────────────────────────
 * Single component wiring together:
 *
 *   BinanceService   → 5-second live price polling
 *   phaseEngine      → market phase classification (1-5)
 *   signalEngine     → BUY / SELL / HOLD from phase
 *   performanceEngine→ rolling success-rate / avg-profit tracker
 *   useSubscription  → plan from Supabase trade_subscriptions
 *   checkSubscription→ per-card access decisions (delay / block)
 *   SignalGate       → blur overlay with countdown / upgrade CTA
 *   UpgradeModal     → 3-step USDT payment + TX verification
 *   usePayment       → wallet generation, verifyPayment(), activateSubscription()
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence }                   from 'framer-motion';
import SignalEngine                                  from '../engines/signalEngine.js';
import PerformanceEngine                             from '../engines/performanceEngine.js';

// Subscription
import { useSubscription }       from '../subscription/useSubscription';
import { PLAN_META, type PlanId } from '../subscription/subscriptionConfig';
import SignalGate                from './SignalGate';
import UpgradeModal              from './UpgradeModal';
import PlanBadge                 from './PlanBadge';

// ── Types ─────────────────────────────────────────────────────────────────────

type SignalLabel = 'BUY' | 'SELL' | 'HOLD';

interface MarketSignal {
  symbol:     string;
  price:      number;
  phase:      number;
  signal:     SignalLabel;
  confidence: number;
  timestamp:  number;
}

interface PerformanceSnapshot {
  success_rate:  number;
  avg_profit:    number;
  total_trades:  number;
}

const EMPTY_PERFORMANCE: PerformanceSnapshot = { success_rate: 0, avg_profit: 0, total_trades: 0 };

const SYMBOL_ORDER = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'] as const;

const SYMBOL_META: Record<string, { name: string; short: string; icon: string; color: string }> = {
  BTCUSDT: { name: 'Bitcoin',  short: 'BTC', icon: 'fa-brands fa-bitcoin',  color: '#F7931A' },
  ETHUSDT: { name: 'Ethereum', short: 'ETH', icon: 'fa-brands fa-ethereum', color: '#627EEA' },
  BNBUSDT: { name: 'BNB',      short: 'BNB', icon: 'fa-solid fa-coins',     color: '#F0B90B' },
};

const SIGNAL_META: Record<SignalLabel, { color: string; bg: string; border: string; icon: string; label: string }> = {
  BUY:  { color: '#10B981', bg: 'rgba(16,185,129,.15)', border: 'rgba(16,185,129,.35)', icon: 'fa-solid fa-arrow-trend-up',   label: 'AL'   },
  SELL: { color: '#EF4444', bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.35)',  icon: 'fa-solid fa-arrow-trend-down', label: 'SAT'  },
  HOLD: { color: '#F59E0B', bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.35)', icon: 'fa-solid fa-pause',            label: 'BEKLE'},
};

const PHASE_LABELS = ['', 'Güçlü Yükseliş', 'Yükseliş', 'Nötr', 'Düşüş', 'Güçlü Düşüş'];
const PHASE_COLORS = ['', '#10B981', '#34D399', '#94A3B8', '#F87171', '#EF4444'];

function fmt(v: number) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v >= 100 ? 2 : 4 });
}

function timeAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 2)  return 'az önce';
  if (s < 60) return `${s}s önce`;
  return `${Math.round(s / 60)}dk önce`;
}

// ── Live-signal hook ──────────────────────────────────────────────────────────

function useTradeSignals() {
  const [marketData,      setMarketData]      = useState<Record<string, MarketSignal>>({});
  const [perSymbolPerf,   setPerSymbolPerf]   = useState<Record<string, PerformanceSnapshot>>({});
  const [overallPerf,     setOverallPerf]     = useState<PerformanceSnapshot>(EMPTY_PERFORMANCE);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const engine            = new SignalEngine();
    const perfEngines       = new Map<string, PerformanceEngine>();
    const overallPerfEngine = new PerformanceEngine();
    const openPositions     = new Map<string, { signal: SignalLabel; entryPrice: number }>();
    const latestPrice       = new Map<string, number>();

    const getPerfEngine = (sym: string) => {
      if (!perfEngines.has(sym)) perfEngines.set(sym, new PerformanceEngine());
      return perfEngines.get(sym)!;
    };

    const onTick = (asset: { symbol: string; price: number }) => {
      latestPrice.set(asset.symbol, asset.price);
    };
    engine.binanceService.on('tick', onTick);

    const onSignal = (sig: MarketSignal) => {
      setConnectionError(null);
      const price = latestPrice.get(sig.symbol);
      if (price == null) return;

      const open = openPositions.get(sig.symbol);
      if (!open) {
        openPositions.set(sig.symbol, { signal: sig.signal, entryPrice: price });
      } else if (open.signal !== sig.signal) {
        const trade = { signal: open.signal, entry_price: open.entryPrice, current_price: price };
        getPerfEngine(sig.symbol).recordSignal(trade);
        overallPerfEngine.recordSignal(trade);
        openPositions.set(sig.symbol, { signal: sig.signal, entryPrice: price });
        setPerSymbolPerf(prev => ({ ...prev, [sig.symbol]: getPerfEngine(sig.symbol).getPerformance() }));
        setOverallPerf(overallPerfEngine.getPerformance());
      }

      setMarketData(prev => ({
        ...prev,
        [sig.symbol]: { symbol: sig.symbol, price, phase: sig.phase, signal: sig.signal, confidence: sig.confidence, timestamp: sig.timestamp },
      }));
    };
    engine.on('signal', onSignal);

    const onError = (err: { message: string }) => setConnectionError(err?.message ?? 'Bağlantı hatası');
    engine.on('error', onError);

    engine.start();
    return () => {
      engine.stop();
      engine.binanceService.off('tick', onTick);
      engine.off('signal', onSignal);
      engine.off('error',  onError);
    };
  }, []);

  const signals = useMemo(
    () => SYMBOL_ORDER.map(s => marketData[s]).filter(Boolean) as MarketSignal[],
    [marketData],
  );

  return { signals, perSymbolPerf, overallPerf, connectionError };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SignalBadge({ signal }: { signal: SignalLabel }) {
  const m = SIGNAL_META[signal];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-extrabold"
      style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}
    >
      <i className={m.icon} />{signal} <span style={{ opacity: .7, fontSize: 10 }}>({m.label})</span>
    </span>
  );
}

function ConfidenceBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-[#0D1525] overflow-hidden">
      <motion.div className="h-full rounded-full" style={{ background: color }}
        initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.45 }} />
    </div>
  );
}

function PhaseIndicator({ phase }: { phase: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(p => (
        <span key={p} className="w-2 h-2 rounded-full transition-all"
          style={{ background: p === phase ? PHASE_COLORS[phase] : '#2A3650', transform: p === phase ? 'scale(1.45)' : 'scale(1)' }} />
      ))}
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div className="rounded-xl border border-[#2A3650] px-4 py-3 flex items-center gap-3" style={{ background: '#131C2C' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm" style={{ background: color + '15', color }}>
        <i className={icon} />
      </div>
      <div>
        <p className="text-[9px] text-[#5E7090] font-mono font-bold tracking-wider">{label}</p>
        <p className="text-white font-mono font-extrabold text-sm">{value}</p>
      </div>
    </div>
  );
}

function SignalCard({ data, performance, showAnalytics }: { data: MarketSignal; performance: PerformanceSnapshot; showAnalytics: boolean }) {
  const meta       = SYMBOL_META[data.symbol] ?? { name: data.symbol, short: data.symbol, icon: 'fa-solid fa-coins', color: '#94A3B8' };
  const signalMeta = SIGNAL_META[data.signal];
  const [change24h, setChange24h] = useState<number | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="rounded-2xl border p-5"
      style={{ background: '#131C2C', borderColor: signalMeta.border }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: meta.color + '18', color: meta.color }}>
            <i className={meta.icon} />
          </div>
          <div>
            <p className="text-white font-extrabold text-sm">{meta.short}/USDT</p>
            <p className="text-[#5E7090] text-[10px] font-mono">{meta.name}</p>
          </div>
        </div>
        <SignalBadge signal={data.signal} />
      </div>

      {/* Price */}
      <p className="text-white font-mono font-black text-2xl mb-3">{fmt(data.price)}</p>

      {/* Phase + Confidence */}
      <div className="space-y-3">
        <div>
          <p className="text-[10px] text-[#5E7090] font-mono font-bold mb-1.5">
            FAZ {data.phase}/5 · {PHASE_LABELS[data.phase]}
          </p>
          <PhaseIndicator phase={data.phase} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[#5E7090] font-mono font-bold">GÜVEN SKORU</span>
            <span className="text-[11px] font-mono font-extrabold" style={{ color: signalMeta.color }}>{data.confidence}%</span>
          </div>
          <ConfidenceBar value={data.confidence} color={signalMeta.color} />
        </div>
      </div>

      {/* VIP analytics */}
      {showAnalytics && (
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#2A3650]">
          <div>
            <p className="text-[9px] text-[#5E7090] font-mono font-bold">BAŞARI</p>
            <p className="text-white font-mono font-bold text-xs">
              {performance.total_trades > 0 ? `${performance.success_rate}%` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-[#5E7090] font-mono font-bold">ORT. KAR</p>
            <p className="font-mono font-bold text-xs"
              style={{ color: performance.total_trades === 0 ? '#A3B3D1' : performance.avg_profit >= 0 ? '#10B981' : '#EF4444' }}>
              {performance.total_trades > 0 ? `${performance.avg_profit > 0 ? '+' : ''}${performance.avg_profit}%` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-[#5E7090] font-mono font-bold">İŞLEM</p>
            <p className="text-white font-mono font-bold text-xs">{performance.total_trades}</p>
          </div>
        </div>
      )}

      <p className="text-[#5E7090] text-[10px] font-mono mt-3">{timeAgo(data.timestamp)}</p>
    </motion.div>
  );
}

function PlanComparisonStrip({ currentPlan, onUpgrade }: { currentPlan: PlanId; onUpgrade: () => void }) {
  return (
    <div className="rounded-2xl border border-[#2A3650] p-5" style={{ background: '#131C2C' }}>
      <p className="text-[10px] text-[#5E7090] font-mono font-bold mb-4">PLAN KARŞILAŞTIRMA</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {(['FREE', 'PRO', 'VIP'] as const).map(pid => {
          const m         = PLAN_META[pid];
          const isCurrent = pid === currentPlan;
          return (
            <div key={pid} style={{ background: isCurrent ? `${m.color}08` : '#0D1525', border: `1px solid ${isCurrent ? m.color : '#2A3650'}`, borderRadius: 12, padding: 14 }}>
              <div style={{ color: m.color, fontWeight: 900, fontSize: 13, marginBottom: 4 }}>{m.badge}</div>
              <div style={{ fontFamily: "'Courier New',monospace", fontSize: 18, fontWeight: 900, marginBottom: 10, color: '#E2E8F0' }}>
                {m.price === 0 ? 'Ücretsiz' : `$${m.price}/ay`}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 11, color: '#A3B3D1', lineHeight: 1.85 }}>
                {m.features.map(f => <li key={f}><span style={{ color: m.color, marginRight: 5 }}>✓</span>{f}</li>)}
              </ul>
              {isCurrent ? (
                <div style={{ marginTop: 10, fontSize: 10, color: m.color, fontFamily: "'Courier New',monospace", fontWeight: 700 }}>✓ Mevcut planınız</div>
              ) : pid !== 'FREE' ? (
                <button onClick={onUpgrade} style={{ marginTop: 10, width: '100%', background: `linear-gradient(135deg,${m.color},${m.color}bb)`, color: '#000', border: 'none', borderRadius: 8, padding: '7px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  {m.label}'e Geç
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── History table component ───────────────────────────────────────────────────

function HistoryTable({ perfEngines }: { perfEngines: Record<string, PerformanceSnapshot> }) {
  return (
    <div className="rounded-2xl border border-[#2A3650]" style={{ background: '#131C2C', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #2A3650' }}>
        <p className="text-white font-extrabold text-sm flex items-center gap-2">
          <i className="fas fa-table text-[#D4AF37]" /> Sembol Performansı
        </p>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Sembol', 'Başarı Oranı', 'Ort. Kar', 'Toplam İşlem', 'Durum'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '9px 12px', background: 'rgba(42,54,80,.5)', color: '#5E7090', fontFamily: "'Courier New',monospace", fontSize: 10, fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SYMBOL_ORDER.map(sym => {
            const perf = perfEngines[sym] ?? EMPTY_PERFORMANCE;
            const meta = SYMBOL_META[sym];
            const sr   = perf.success_rate;
            const srColor = sr >= 60 ? '#10B981' : sr >= 40 ? '#F59E0B' : '#EF4444';
            return (
              <tr key={sym}>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(42,54,80,.4)' }}>
                  <div className="flex items-center gap-2">
                    <i className={meta.icon} style={{ color: meta.color }} />
                    <span className="font-mono font-bold">{meta.short}/USDT</span>
                  </div>
                </td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(42,54,80,.4)', fontFamily: "'Courier New',monospace", fontWeight: 700, color: srColor }}>
                  {perf.total_trades > 0 ? `${sr}%` : '—'}
                </td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(42,54,80,.4)', fontFamily: "'Courier New',monospace", color: perf.avg_profit >= 0 ? '#10B981' : '#EF4444' }}>
                  {perf.total_trades > 0 ? `${perf.avg_profit > 0 ? '+' : ''}${perf.avg_profit}%` : '—'}
                </td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(42,54,80,.4)', fontFamily: "'Courier New',monospace" }}>
                  {perf.total_trades || '—'}
                </td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(42,54,80,.4)' }}>
                  {perf.total_trades === 0 ? (
                    <span style={{ fontSize: 10, color: '#5E7090' }}>sinyal bekleniyor…</span>
                  ) : (
                    <span style={{ background: srColor + '15', color: srColor, border: `1px solid ${srColor}40`, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontFamily: "'Courier New',monospace", fontWeight: 700 }}>
                      {sr >= 60 ? '🟢 İyi' : sr >= 40 ? '🟡 Orta' : '🔴 Zayıf'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Full page ─────────────────────────────────────────────────────────────────

export default function TradeSignals() {
  const { signals, perSymbolPerf, overallPerf, connectionError } = useTradeSignals();

  const {
    plan, check,
    canHistory, canAnalytics,
    loading: subLoading,
    refresh,
  } = useSubscription();

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [activeTab,   setActiveTab]   = useState<'signals' | 'history'>('signals');

  const openUpgrade = useCallback(() => setUpgradeOpen(true),  []);
  const closeUpgrade = useCallback(() => setUpgradeOpen(false), []);
  const handleSuccess = useCallback(() => { closeUpgrade(); refresh(); }, [refresh]);

  return (
    <div className="min-h-screen" style={{ background: '#0A0E1A' }}>
      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">

        {/* ── Page header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-white font-black text-2xl flex items-center gap-2 flex-wrap">
              <i className="fas fa-chart-line text-[#D4AF37]" />
              Trade Signals
              <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />LIVE
              </span>
            </h1>
            <p className="text-[#5E7090] text-xs font-mono mt-1">BTC · ETH · BNB — her 5 saniyede bir güncellenir</p>
          </div>

          {/* Stats + plan badge + upgrade */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatCard
              label="BAŞARI ORANI"
              value={overallPerf.total_trades > 0 ? `${overallPerf.success_rate}% (${overallPerf.total_trades})` : 'Toplanıyor…'}
              color="#10B981"
              icon="fas fa-bullseye"
            />
            {!subLoading && <PlanBadge plan={plan} size="md" />}
            {!subLoading && plan !== 'VIP' && (
              <button
                onClick={openUpgrade}
                style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                ⬆ {plan === 'FREE' ? "PRO'ya Geç" : "VIP'e Geç"}
              </button>
            )}
          </div>
        </div>

        {/* Connection error */}
        {connectionError && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-red-300 text-xs font-mono">
            <i className="fas fa-triangle-exclamation mr-2" />Binance verisi alınamadı, yeniden deneniyor: {connectionError}
          </div>
        )}

        {/* FREE plan banner */}
        {plan === 'FREE' && (
          <div className="rounded-xl border border-[#D4AF37]/25 px-4 py-3 flex items-center justify-between gap-3"
            style={{ background: 'rgba(212,175,55,.06)' }}>
            <div className="text-[13px] text-[#A3B3D1]">
              ⏰ <strong className="text-[#D4AF37]">FREE plan</strong> — ilk kart anlık, diğerleri 15 dk gecikmeli. PRO ile tüm sinyaller gerçek zamanlı.
            </div>
            <button onClick={openUpgrade}
              style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ⚡ Yükselt
            </button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'signals', label: '📡 Sinyaller', locked: false },
            { id: 'history', label: '📋 Performans', locked: !canHistory },
          ].map(tab => (
            <button key={tab.id}
              onClick={() => { if (tab.locked) { openUpgrade(); return; } setActiveTab(tab.id as typeof activeTab); }}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                fontFamily: "'Courier New',monospace",
                border: `1px solid ${activeTab === tab.id ? '#D4AF37' : '#2A3650'}`,
                background: activeTab === tab.id ? '#D4AF37' : '#131C2C',
                color: activeTab === tab.id ? '#000' : tab.locked ? '#3A4A60' : '#5E7090',
                display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'all .15s',
              }}>
              {tab.label}
              {tab.locked && <span style={{ fontSize: 9 }}>🔒</span>}
            </button>
          ))}
        </div>

        {/* Signal cards */}
        {activeTab === 'signals' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            <AnimatePresence>
              {signals.length === 0 && (
                <div className="col-span-full text-center text-[#5E7090] font-mono text-sm py-16">
                  <i className="fas fa-circle-notch fa-spin mr-2 text-lg" />
                  Binance'e bağlanılıyor, piyasa verisi yükleniyor…
                </div>
              )}
              {signals.map((sig, idx) => {
                const access = check({ symbol: sig.symbol, confidence: sig.confidence, timestamp: sig.timestamp }, idx);
                return (
                  <SignalGate key={sig.symbol} access={access} onUpgrade={openUpgrade}>
                    <SignalCard
                      data={sig}
                      performance={perSymbolPerf[sig.symbol] ?? EMPTY_PERFORMANCE}
                      showAnalytics={canAnalytics}
                    />
                  </SignalGate>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* History / Performance tab */}
        {activeTab === 'history' && canHistory && (
          <HistoryTable perfEngines={perSymbolPerf} />
        )}

        {/* Plan comparison (non-VIP) */}
        {plan !== 'VIP' && (
          <PlanComparisonStrip currentPlan={plan} onUpgrade={openUpgrade} />
        )}

      </main>

      <UpgradeModal
        open={upgradeOpen}
        onClose={closeUpgrade}
        onSuccess={handleSuccess}
        defaultPlan={plan === 'FREE' ? 'PRO' : 'VIP'}
      />
    </div>
  );
}

// ── Dashboard widget ──────────────────────────────────────────────────────────

export function TradeSignalsWidget() {
  const { signals, overallPerf } = useTradeSignals();
  const { plan, check }          = useSubscription();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { refresh } = useSubscription();

  const top3 = useMemo(
    () => [...signals].sort((a, b) => b.confidence - a.confidence).slice(0, 3),
    [signals],
  );

  return (
    <>
      <div className="rounded-2xl border border-[#2A3650] p-5" style={{ background: '#131C2C' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-extrabold text-sm flex items-center gap-2">
            <i className="fas fa-chart-line text-[#D4AF37]" /> CANLI TRADE SİNYALLERİ
          </h3>
          <div className="flex items-center gap-2">
            <PlanBadge plan={plan} size="sm" />
          </div>
        </div>

        {top3.length === 0 ? (
          <p className="text-[#5E7090] text-xs font-mono py-5 text-center">
            <i className="fas fa-circle-notch fa-spin mr-2" />Yükleniyor…
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {top3.map((s, i) => {
              const meta   = SYMBOL_META[s.symbol];
              const access = check({ symbol: s.symbol, confidence: s.confidence, timestamp: s.timestamp }, i);
              const gated  = !access.allowed;
              return (
                <div key={s.symbol}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                  style={{ background: '#0D1525' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[#5E7090] font-mono text-[10px] font-bold w-4">{i + 1}</span>
                    <i className={meta.icon} style={{ color: meta.color, fontSize: 13 }} />
                    <span className="text-white font-mono text-xs font-bold">{meta.short}</span>
                  </div>
                  {gated ? (
                    <button onClick={() => setUpgradeOpen(true)}
                      style={{ fontSize: 10, color: '#D4AF37', background: 'rgba(212,175,55,.1)', border: '1px solid rgba(212,175,55,.25)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: "'Courier New',monospace" }}>
                      {access.delayed ? `⏱ ${access.delayLabel}` : '🔒 Yükselt'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-[#5E7090]">{s.confidence}%</span>
                      <SignalBadge signal={s.signal} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-[#2A3650] pt-3 flex items-center justify-between">
          <span className="text-[10px] text-[#5E7090] font-mono font-bold">BAŞARI ORANI</span>
          <span className="text-white font-mono font-extrabold text-sm">
            {overallPerf.total_trades > 0 ? `${overallPerf.success_rate}%` : '—'}
          </span>
        </div>

        {plan !== 'VIP' && (
          <button onClick={() => setUpgradeOpen(true)}
            style={{ width: '100%', marginTop: 12, padding: '9px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', fontWeight: 800, cursor: 'pointer', fontSize: 12, fontFamily: "'Courier New',monospace" }}>
            ⚡ {plan === 'FREE' ? 'PRO — $29/ay' : 'VIP — $79/ay'}
          </button>
        )}
      </div>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onSuccess={() => { setUpgradeOpen(false); refresh(); }}
        defaultPlan={plan === 'FREE' ? 'PRO' : 'VIP'}
      />
    </>
  );
}
