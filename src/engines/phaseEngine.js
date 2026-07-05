/**
 * phaseEngine.js
 * ------------------------------------------------------------------
 * Classifies an asset's current market state into one of 5 phases
 * using three inputs: 24h price change, trading volume, and short-term
 * volatility (derived from a rolling price history kept per symbol).
 *
 * Phase scale (1 = strongest bullish, 5 = strongest bearish):
 *   1  Strong bullish   (high conviction upward move)
 *   2  Bullish          (moderate upward move)
 *   3  Neutral          (no clear directional conviction)
 *   4  Bearish          (moderate downward move)
 *   5  Strong bearish   (high conviction downward move)
 *
 * `score` (0-100) expresses how strong/confident that classification is.
 * Volume confirms or dampens the move; volatility dampens confidence,
 * since noisy/erratic price action is less trustworthy as a signal.
 *
 * Public API:
 *   import { calculatePhase, PhaseEngine } from './phaseEngine.js';
 *   const { phase, score } = calculatePhase(asset);
 *
 *   // or, for isolated state (e.g. tests, multiple independent feeds):
 *   const engine = new PhaseEngine();
 *   const result = engine.calculatePhase(asset);
 * ------------------------------------------------------------------
 */

const DEFAULT_HISTORY_SIZE = 20;
const MIN_SAMPLES_FOR_VOLATILITY = 3;
const MAX_CHANGE_PCT = 15; // % move treated as "maximum" directional strength
const PHASE_THRESHOLDS = { strong: 0.5, moderate: 0.15 };

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const mean = (arr) => arr.reduce((sum, v) => sum + v, 0) / arr.length;

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const variance = mean(arr.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

class PhaseEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.historySize] - Rolling samples kept per symbol.
   * @param {number} [options.volatilityDampingFactor] - Higher = volatility
   *   suppresses confidence more aggressively.
   */
  constructor(options = {}) {
    this.historySize = options.historySize ?? DEFAULT_HISTORY_SIZE;
    this.volatilityDampingFactor = options.volatilityDampingFactor ?? 8;
    this._history = new Map(); // symbol -> [{ price, volume }]
  }

  /** Clear stored history for one symbol, or all symbols if omitted. */
  reset(symbol) {
    if (symbol) this._history.delete(symbol.toUpperCase());
    else this._history.clear();
  }

  /**
   * @param {Object} asset
   * @param {string} asset.symbol
   * @param {number} asset.price
   * @param {number} asset.change_24h - 24h percent change (e.g. 3.25 for +3.25%)
   * @param {number} asset.volume
   * @param {number} [asset.high_24h]
   * @param {number} [asset.low_24h]
   * @returns {{ phase: number, score: number }}
   */
  calculatePhase(asset) {
    if (!asset || typeof asset.symbol !== 'string') {
      throw new Error('calculatePhase: a valid asset object with a symbol is required.');
    }

    const symbol = asset.symbol.toUpperCase();
    const price = Number(asset.price);
    const change24h = Number(asset.change_24h) || 0;
    const volume = Number(asset.volume) || 0;

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`calculatePhase: invalid price for ${symbol}.`);
    }

    const history = this._recordSample(symbol, price, volume);

    const directionScore = this._directionScore(change24h);
    const volumeFactor = this._volumeFactor(history, volume);
    const volatilityFactor = this._volatilityFactor(history, asset, price);

    // Conviction blends volume confirmation with a volatility penalty.
    const conviction = clamp(volumeFactor * volatilityFactor, 0, 1.5);

    // Signed composite in roughly [-1, 1]; direction comes from price change,
    // magnitude (confidence) comes from volume + volatility context.
    const composite = clamp(directionScore * conviction, -1, 1);

    return {
      phase: this._toPhase(composite),
      score: Math.round(Math.abs(composite) * 100),
    };
  }

  /** Internal: push a new sample into the symbol's rolling history. */
  _recordSample(symbol, price, volume) {
    const history = this._history.get(symbol) ?? [];
    history.push({ price, volume });
    if (history.length > this.historySize) history.shift();
    this._history.set(symbol, history);
    return history;
  }

  /** Internal: normalize 24h % change into a signed direction strength [-1, 1]. */
  _directionScore(change24h) {
    return clamp(change24h / MAX_CHANGE_PCT, -1, 1);
  }

  /**
   * Internal: how current volume compares to the symbol's recent average.
   * Above-average volume amplifies conviction; below-average dampens it.
   * Returns a multiplier centered around 1.
   */
  _volumeFactor(history, currentVolume) {
    const volumes = history.map((h) => h.volume).filter((v) => v > 0);
    if (volumes.length < 2 || currentVolume <= 0) return 1;

    const avgVolume = mean(volumes);
    if (avgVolume === 0) return 1;

    const ratio = currentVolume / avgVolume;
    return clamp(ratio, 0.4, 1.6); // bounded so one outlier can't dominate
  }

  /**
   * Internal: volatility-based damping multiplier in (0, 1].
   * Prefers rolling price-return volatility once enough samples exist;
   * falls back to the 24h high/low range when history is too short.
   */
  _volatilityFactor(history, asset, price) {
    const prices = history.map((h) => h.price);
    let volatilityPct;

    if (prices.length >= MIN_SAMPLES_FOR_VOLATILITY) {
      const returns = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
      volatilityPct = stdDev(returns) * 100;
    } else if (Number.isFinite(asset.high_24h) && Number.isFinite(asset.low_24h) && price > 0) {
      volatilityPct = ((asset.high_24h - asset.low_24h) / price) * 100;
    } else {
      volatilityPct = 1; // neutral default when no volatility signal is available
    }

    return clamp(1 / (1 + volatilityPct / this.volatilityDampingFactor), 0.2, 1);
  }

  /** Internal: map a signed composite score in [-1, 1] to a phase 1-5. */
  _toPhase(composite) {
    if (composite >= PHASE_THRESHOLDS.strong) return 1;
    if (composite >= PHASE_THRESHOLDS.moderate) return 2;
    if (composite > -PHASE_THRESHOLDS.moderate) return 3;
    if (composite > -PHASE_THRESHOLDS.strong) return 4;
    return 5;
  }
}

// Shared default instance so `calculatePhase(asset)` works as a plain
// function while still tracking rolling history across calls per symbol.
const defaultEngine = new PhaseEngine();

/**
 * @param {Object} asset - { symbol, price, change_24h, volume, high_24h?, low_24h? }
 * @returns {{ phase: number, score: number }}
 */
function calculatePhase(asset) {
  return defaultEngine.calculatePhase(asset);
}

export default calculatePhase;
export { calculatePhase, PhaseEngine };
