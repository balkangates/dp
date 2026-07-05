/**
 * SignalGate.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps a signal card.  Reads an AccessDecision and either:
 *   • renders children as-is          (allowed)
 *   • renders a blur + countdown      (delayed)
 *   • renders a blur + upgrade CTA    (blocked)
 *
 * Props:
 *   access     AccessDecision from checkSubscription()
 *   onUpgrade  callback to open the payment modal
 *   children   the actual signal card to wrap
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import type { AccessDecision } from '../subscription/checkSubscription';

interface SignalGateProps {
  access:    AccessDecision;
  onUpgrade: () => void;
  children:  React.ReactNode;
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function useCountdown(initialSeconds: number) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);   // intentionally not re-running — initialSeconds is stable per render

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const label = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  return { seconds, label };
}

// ── Overlay base ──────────────────────────────────────────────────────────────

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position:       'absolute',
        inset:          0,
        background:     'rgba(7, 11, 20, 0.82)',
        backdropFilter: 'blur(7px)',
        borderRadius:   'inherit',
        zIndex:         10,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            10,
        padding:        16,
        textAlign:      'center',
      }}
    >
      {children}
    </div>
  );
}

// ── Delayed overlay ───────────────────────────────────────────────────────────

function DelayedOverlay({
  initialSeconds,
  reason,
  onUpgrade,
}: {
  initialSeconds: number;
  reason:         string;
  onUpgrade:      () => void;
}) {
  const { seconds, label } = useCountdown(initialSeconds);
  const revealed = seconds === 0;

  if (revealed) return null; // parent will re-check and remove gate

  return (
    <Overlay>
      <div
        style={{
          width:        52,
          height:       52,
          borderRadius: '50%',
          background:   'rgba(245,158,11,.12)',
          border:       '1px solid rgba(245,158,11,.3)',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          fontSize:     22,
        }}
      >
        ⏱
      </div>

      <span
        style={{
          fontSize:   28,
          fontWeight: 900,
          fontFamily: "'Courier New', monospace",
          color:      '#F59E0B',
          letterSpacing: 2,
        }}
      >
        {label}
      </span>

      <p style={{ fontSize: 11, color: '#A3B3D1', lineHeight: 1.5, maxWidth: 200 }}>
        {reason}
      </p>

      <button
        onClick={onUpgrade}
        style={{
          marginTop:    4,
          background:   'linear-gradient(135deg,#D4AF37,#F5D76E)',
          color:        '#000',
          border:       'none',
          borderRadius: 9,
          padding:      '7px 16px',
          fontSize:     11,
          fontWeight:   700,
          cursor:       'pointer',
        }}
      >
        PRO ile gerçek zamanlı →
      </button>
    </Overlay>
  );
}

// ── Blocked overlay ───────────────────────────────────────────────────────────

function BlockedOverlay({
  reason,
  onUpgrade,
}: {
  reason:    string;
  onUpgrade: () => void;
}) {
  return (
    <Overlay>
      <div
        style={{
          width:        48,
          height:       48,
          borderRadius: '50%',
          background:   'rgba(212,175,55,.1)',
          border:       '1px solid rgba(212,175,55,.25)',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          fontSize:     20,
        }}
      >
        🔒
      </div>

      <p style={{ fontSize: 11, color: '#A3B3D1', lineHeight: 1.5, maxWidth: 200 }}>
        {reason}
      </p>

      <button
        onClick={onUpgrade}
        style={{
          background:   'linear-gradient(135deg,#D4AF37,#F5D76E)',
          color:        '#000',
          border:       'none',
          borderRadius: 9,
          padding:      '7px 16px',
          fontSize:     11,
          fontWeight:   700,
          cursor:       'pointer',
        }}
      >
        Planı Yükselt
      </button>
    </Overlay>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export default function SignalGate({ access, onUpgrade, children }: SignalGateProps) {
  // Fully allowed — no wrapper needed
  if (access.allowed) {
    return <>{children}</>;
  }

  return (
    <div style={{ position: 'relative', borderRadius: 'inherit' }}>
      {/* Render the card underneath (blurred by the overlay) */}
      <div style={{ pointerEvents: 'none', userSelect: 'none' }}>{children}</div>

      {access.delayed ? (
        <DelayedOverlay
          initialSeconds={access.delaySeconds}
          reason={access.reason}
          onUpgrade={onUpgrade}
        />
      ) : (
        <BlockedOverlay
          reason={access.reason}
          onUpgrade={onUpgrade}
        />
      )}
    </div>
  );
}
