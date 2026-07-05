/**
 * useSubscription.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * React hook: loads the current user's subscription from Supabase and
 * exposes it along with a `check()` helper pre-bound to that subscription.
 *
 * Drop-in:
 *   const { subscription, plan, check, loading } = useSubscription();
 *   const access = check(signal, symbolIndex);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  checkSubscription,
  canViewHistory,
  canViewAnalytics,
  type Subscription,
  type SignalInput,
} from './checkSubscription';
import { type PlanId, PLAN_META } from './subscriptionConfig';

export interface UseSubscriptionReturn {
  /** Raw subscription row, or null while loading / no record. */
  subscription: Subscription | null;

  /** Resolved plan ID (defaults to 'FREE' if no active subscription). */
  plan: PlanId;

  /** Plan display metadata (label, color, features, …). */
  planMeta: (typeof PLAN_META)[PlanId];

  /** True during the initial Supabase fetch. */
  loading: boolean;

  /** Pre-bound checkSubscription — pass a signal + optional symbol index. */
  check: (signal: SignalInput, symbolIndex?: number) => ReturnType<typeof checkSubscription>;

  /** Shortcuts (pre-computed from the resolved plan). */
  canHistory:   boolean;
  canAnalytics: boolean;

  /** Call after a successful payment to refresh without a page reload. */
  refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionReturn {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading]           = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from('trade_subscriptions')
      .select('plan, status, expires_at')
      .eq('user_id', user.id)
      .maybeSingle();

    // Treat expired rows as no subscription
    const isActive =
      data?.status === 'active' &&
      (!data.expires_at || new Date(data.expires_at) > new Date());

    setSubscription(isActive ? (data as Subscription) : null);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const plan: PlanId =
    subscription?.status === 'active' && subscription.plan in PLAN_META
      ? subscription.plan
      : 'FREE';

  const check = useCallback(
    (signal: SignalInput, symbolIndex = 0) =>
      checkSubscription(subscription, signal, symbolIndex),
    [subscription],
  );

  return {
    subscription,
    plan,
    planMeta:     PLAN_META[plan],
    loading,
    check,
    canHistory:   canViewHistory(subscription),
    canAnalytics: canViewAnalytics(subscription),
    refresh:      load,
  };
}
