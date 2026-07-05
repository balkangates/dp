/**
 * subscriptionConfig.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for every plan rule.
 *
 * Add a new plan:  add a key to PLANS and a row to PLAN_META.
 * Add a new rule:  add a field to PlanRules and handle it in checkSubscription.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Plan IDs ─────────────────────────────────────────────────────────────────

export type PlanId = 'FREE' | 'PRO' | 'VIP';

// ── Rule shape ────────────────────────────────────────────────────────────────

export interface PlanRules {
  /** Signals are delayed by this many minutes (0 = real-time). */
  delayMinutes: number;

  /** Minimum confidence % a signal must have to be visible (0 = all signals). */
  minConfidence: number;

  /** How many symbols the user can monitor simultaneously (0 = unlimited). */
  symbolLimit: number;

  /** Whether performance history tab is accessible. */
  historyAccess: boolean;

  /** Whether per-symbol breakdown stats are shown. */
  analyticsAccess: boolean;
}

// ── Plan definitions ──────────────────────────────────────────────────────────

export const PLANS: Record<PlanId, PlanRules> = {
  FREE: {
    delayMinutes:   15,
    minConfidence:  0,
    symbolLimit:    1,    // only first symbol shown
    historyAccess:  false,
    analyticsAccess: false,
  },
  PRO: {
    delayMinutes:   0,    // real-time
    minConfidence:  0,    // all signals
    symbolLimit:    0,    // unlimited
    historyAccess:  true,
    analyticsAccess: false,
  },
  VIP: {
    delayMinutes:   0,    // real-time
    minConfidence:  65,   // only high-confidence signals
    symbolLimit:    0,    // unlimited
    historyAccess:  true,
    analyticsAccess: true,
  },
};

// ── UI metadata (labels, pricing, descriptions) ───────────────────────────────

export interface PlanMeta {
  id:          PlanId;
  label:       string;
  price:       number;   // USD/month (0 = free)
  color:       string;
  badgeColor:  string;
  badgeBg:     string;
  badge:       string;
  tagline:     string;
  features:    string[];
}

export const PLAN_META: Record<PlanId, PlanMeta> = {
  FREE: {
    id:         'FREE',
    label:      'Free',
    price:      0,
    color:      '#5E7090',
    badgeColor: '#5E7090',
    badgeBg:    'rgba(94,112,144,.12)',
    badge:      '○ FREE',
    tagline:    'Başlangıç için',
    features: [
      '1 sembol izleme',
      '15 dk gecikmeli sinyaller',
      'Temel faz göstergesi',
    ],
  },
  PRO: {
    id:         'PRO',
    label:      'Pro',
    price:      29,
    color:      '#38BDF8',
    badgeColor: '#38BDF8',
    badgeBg:    'rgba(56,189,248,.12)',
    badge:      '◆ PRO',
    tagline:    'Aktif trader için',
    features: [
      'Tüm semboller',
      'Gerçek zamanlı sinyaller',
      'Tüm sinyal seviyeleri',
      'Sinyal geçmişi',
    ],
  },
  VIP: {
    id:         'VIP',
    label:      'VIP',
    price:      79,
    color:      '#D4AF37',
    badgeColor: '#D4AF37',
    badgeBg:    'rgba(212,175,55,.12)',
    badge:      '★ VIP',
    tagline:    'Profesyonel trader için',
    features: [
      'PRO\'nun tüm özellikleri',
      'Sadece yüksek güven sinyalleri (≥65%)',
      'Sembol başı analitik',
      'Öncelikli destek',
    ],
  },
};
