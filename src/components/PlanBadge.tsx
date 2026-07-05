/**
 * PlanBadge.tsx
 * Small pill that shows the user's current plan with a consistent style.
 *
 * Usage:
 *   <PlanBadge plan="PRO" />
 *   <PlanBadge plan={planMeta.id} size="lg" />
 */

import { PLAN_META, type PlanId } from '../subscription/subscriptionConfig';

interface PlanBadgeProps {
  plan: PlanId;
  size?: 'sm' | 'md' | 'lg';
}

export default function PlanBadge({ plan, size = 'md' }: PlanBadgeProps) {
  const m = PLAN_META[plan];
  const fontSize = size === 'sm' ? 9 : size === 'lg' ? 12 : 10;
  const padding  = size === 'sm' ? '2px 7px' : size === 'lg' ? '5px 13px' : '3px 9px';

  return (
    <span
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        borderRadius: 20,
        fontSize,
        padding,
        fontFamily:   "'Courier New', monospace",
        fontWeight:   700,
        letterSpacing: '.5px',
        background:   m.badgeBg,
        color:        m.badgeColor,
        border:       `1px solid ${m.color}40`,
        userSelect:   'none',
      }}
    >
      {m.badge}
    </span>
  );
}
