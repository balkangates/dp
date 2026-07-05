/**
 * checkSubscription.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The single entry-point for all access-control decisions.
 *
 * Usage:
 *   const access = checkSubscription(subscription, signal);
 *   if (!access.allowed)  -> blur the card, show access.reason
 *   if (access.delayed)   -> show access.delayLabel instead of live price
 *   if (!access.statsVisible) -> hide per-symbol analytics
 *
 * Extending:
 *   1. Add a rule field to PlanRules in subscriptionConfig.ts.
 *   2. Add a check below and expose a new boolean in AccessDecision.
 *   UI components read AccessDecision — they never inspect plan IDs directly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PLANS, type PlanId, type PlanRules } from './subscriptionConfig';

// ── Subscription record (mirrors Supabase trade_subscriptions row) ────────────

export interface Subscription {
  plan:       PlanId;
  status:     'active' | 'expired' | 'cancelled';
  expires_at: string | null;
}

// ── Signal shape (minimal — only what the gate needs) ─────────────────────────

export interface SignalInput {
  symbol:     string;
  confidence: number;   // 0-100
  timestamp:  number;   // Unix ms — used for delay check
}

// ── Decision shape ────────────────────────────────────────────────────────────

export interface AccessDecision {
  /** True when signal is fully visible with no restrictions. */
  allowed:       boolean;

  /** True when signal exists but is hidden (blur it, show upgrade CTA). */
  blocked:       boolean;

  /** True when signal is visible but price/data is held back (show countdown). */
  delayed:       boolean;

  /** How many seconds remain until the delayed signal is revealed (0 when live). */
  delaySeconds:  number;

  /** Human-readable countdown string, e.g. "12 dk 3 sn". */
  delayLabel:    string;

  /** True when the per-symbol stats panel should be rendered. */
  statsVisible:  boolean;

  /** True when the history tab should be rendered. */
  historyVisible: boolean;

  /** If blocked, what the CTA should say. */
  reason:        string;

  /** The resolved plan rules for this subscription (convenient for UI). */
  rules:         PlanRules;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveRules(sub: Subscription | null): PlanRules {
  const planId: PlanId =
    sub && sub.status === 'active' && sub.plan in PLANS ? sub.plan : 'FREE';
  return PLANS[planId];
}

function formatDelay(seconds: number): string {
  if (seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} sn`;
  return `${m} dk ${s} sn`;
}

// ── Core gate ─────────────────────────────────────────────────────────────────

/**
 * checkSubscription(subscription, signal, symbolIndex?)
 *
 * @param sub          Active subscription row, or null if user has no record.
 * @param signal       The signal to evaluate.
 * @param symbolIndex  0-based position of this symbol in the tracked list.
 *                     Used to enforce symbolLimit for FREE users.
 */
export function checkSubscription(
  sub:          Subscription | null,
  signal:       SignalInput,
  symbolIndex = 0,
): AccessDecision {
  const rules = resolveRules(sub);

  // ── 1. Symbol limit (FREE: only index 0) ─────────────────────────────────
  if (rules.symbolLimit > 0 && symbolIndex >= rules.symbolLimit) {
    return blocked(rules, 'Bu sembolü görmek için PRO veya VIP planına geçin.');
  }

  // ── 2. Confidence gate (VIP: only high-confidence) ───────────────────────
  if (rules.minConfidence > 0 && signal.confidence < rules.minConfidence) {
    return blocked(
      rules,
      `VIP planı yalnızca ${rules.minConfidence}%+ güven skoru olan sinyalleri gösterir. Bu sinyal henüz eşiğin altında.`,
    );
  }

  // ── 3. Delay gate (FREE: 15-min hold) ────────────────────────────────────
  if (rules.delayMinutes > 0) {
    const delayMs      = rules.delayMinutes * 60 * 1000;
    const ageMs        = Date.now() - signal.timestamp;
    const remainingMs  = delayMs - ageMs;

    if (remainingMs > 0) {
      const delaySeconds = Math.ceil(remainingMs / 1000);
      return {
        allowed:        false,
        blocked:        false,
        delayed:        true,
        delaySeconds,
        delayLabel:     formatDelay(delaySeconds),
        statsVisible:   rules.analyticsAccess,
        historyVisible: rules.historyAccess,
        reason:         `Bu sinyal ${formatDelay(delaySeconds)} içinde görünecek. Gerçek zamanlı erişim için PRO planına geçin.`,
        rules,
      };
    }
    // Delay has elapsed — signal is now visible (fall through to allowed)
  }

  // ── 4. Full access ────────────────────────────────────────────────────────
  return {
    allowed:        true,
    blocked:        false,
    delayed:        false,
    delaySeconds:   0,
    delayLabel:     '',
    statsVisible:   rules.analyticsAccess,
    historyVisible: rules.historyAccess,
    reason:         '',
    rules,
  };
}

// ── Convenience: page-level checks (don't need a signal) ─────────────────────

/** Can this user see the history tab at all? */
export function canViewHistory(sub: Subscription | null): boolean {
  return resolveRules(sub).historyAccess;
}

/** Can this user see per-symbol analytics? */
export function canViewAnalytics(sub: Subscription | null): boolean {
  return resolveRules(sub).analyticsAccess;
}

// ── Private factory ───────────────────────────────────────────────────────────

function blocked(rules: PlanRules, reason: string): AccessDecision {
  return {
    allowed:        false,
    blocked:        true,
    delayed:        false,
    delaySeconds:   0,
    delayLabel:     '',
    statsVisible:   rules.analyticsAccess,
    historyVisible: rules.historyAccess,
    reason,
    rules,
  };
}
