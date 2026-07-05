/**
 * src/subscription/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single import point for the entire subscription system.
 *
 * Usage anywhere in the app:
 *   import { useSubscription, checkSubscription, PLAN_META, SignalGate } from '../subscription';
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Core logic
export { checkSubscription, canViewHistory, canViewAnalytics }  from './checkSubscription';
export type { Subscription, SignalInput, AccessDecision }        from './checkSubscription';

// Config
export { PLANS, PLAN_META }   from './subscriptionConfig';
export type { PlanId, PlanRules, PlanMeta } from './subscriptionConfig';

// Hook
export { useSubscription }    from './useSubscription';
export type { UseSubscriptionReturn } from './useSubscription';
