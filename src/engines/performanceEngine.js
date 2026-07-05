/**
 * performanceEngine.js
 * ------------------------------------------------------------------
 * Tracks a rolling window of trading signals and reports how well
 * they performed: win rate, win/loss counts, and average profit.
 *
 * Input shape per tracked signal:
 *   { signal: 'BUY' | 'SELL' | 'HOLD', entry_price: number, current_price: number }
 *
 * Output shape from getPerformance():
 *   { success_rate, avg_profit, total_trades }
 *
 * Design notes:
 *   - Only BUY/SELL signals represent an actual position, so they are
 *     the only ones counted as "trades" for win/loss and profit math.
 *     HOLD entries are still stored in history (for visibility/auditing)
 *     but don't affect success_rate / avg_profit / total_trades.
 *   - Stores at most the last `maxSize` (default 50) signals using a
 *     fixed-size ring buffer, so recording is O(1) regardless of how
 *     long the engine has been running (no array shifting/copying).
 *   - Running aggregates (win count, profit sum, evaluated count) are
 *     updated incrementally on insert/evict, so getPerformance() is
 *     also O(1) rather than re-scanning the whole window every call.
 *   - Stateless w.r.t. symbol: instantiate one PerformanceEngine per
 *     symbol/strategy you want tracked separately, or share one across
 *     symbols if you want an aggregate view.
 *
 * Public API:
 *   import PerformanceEngine from './performanceEngine.js';
 *
 *   const tracker = new PerformanceEngine();
 *   tracker.recordSignal({ signal: 'BUY', entry_price: 60000, current_price: 61200 });
 *   tracker.getPerformance(); // { success_rate, avg_profit, total_trades }
 * ------------------------------------------------------------------
 */

const DEFAULT_MAX_SIZE = 50;
const VALID_SIGNALS = new Set(['BUY', 'SELL', 'HOLD']);

const round2 = (n) => Math.round(n * 100) / 100;

class PerformanceEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxSize] - Max signals retained (default 50).
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    if (!Number.isInteger(this.maxSize) || this.maxSize <= 0) {
      throw new Error('PerformanceEngine: maxSize must be a positive integer.');
    }

    this._buffer = new Array(this.maxSize).fill(null); // ring buffer
    this._head = 0; // index where the next entry will be written
    this._size = 0; // number of slots currently filled (<= maxSize)

    // Running aggregates over evaluated (BUY/SELL) entries only.
    this._evaluatedCount = 0;
    this._winCount = 0;
    this._profitSum = 0; // sum of per-trade profit %
  }

  /**
   * Record a new signal outcome. O(1).
   * @param {Object} record
   * @param {'BUY'|'SELL'|'HOLD'} record.signal
   * @param {number} record.entry_price - Price when the signal was issued.
   * @param {number} record.current_price - Latest/exit price to compare against.
   * @returns {Object} the normalized, stored entry (includes computed pnl).
   */
  recordSignal({ signal, entry_price, current_price } = {}) {
    const normalizedSignal = this._normalizeSignal(signal);
    const entryPrice = Number(entry_price);
    const currentPrice = Number(current_price);

    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      throw new Error('PerformanceEngine.recordSignal: entry_price must be a positive number.');
    }
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw new Error('PerformanceEngine.recordSignal: current_price must be a positive number.');
    }

    const pnlPercent = this._computePnlPercent(normalizedSignal, entryPrice, currentPrice);
    const isEvaluated = pnlPercent !== null;
    const isWin = isEvaluated && pnlPercent > 0;

    const entry = {
      signal: normalizedSignal,
      entry_price: entryPrice,
      current_price: currentPrice,
      pnl_percent: isEvaluated ? round2(pnlPercent) : null,
      is_win: isEvaluated ? isWin : null,
      timestamp: Date.now(),
    };

    // If this slot already holds an entry (buffer is full), evict it
    // from the aggregates before overwriting — keeps stats O(1).
    const evicted = this._buffer[this._head];
    if (evicted) this._removeFromAggregates(evicted);

    this._buffer[this._head] = entry;
    this._head = (this._head + 1) % this.maxSize;
    this._size = Math.min(this._size + 1, this.maxSize);

    this._addToAggregates(entry);

    return entry;
  }

  /**
   * Current performance snapshot over the retained window. O(1).
   * @returns {{ success_rate: number, avg_profit: number, total_trades: number }}
   */
  getPerformance() {
    const totalTrades = this._evaluatedCount; // BUY/SELL only — HOLD isn't a trade

    return {
      success_rate: totalTrades > 0 ? round2((this._winCount / totalTrades) * 100) : 0,
      avg_profit: totalTrades > 0 ? round2(this._profitSum / totalTrades) : 0,
      total_trades: totalTrades,
    };
  }

  /** @returns {{ wins: number, losses: number }} breakdown of evaluated trades. */
  getWinLoss() {
    return {
      wins: this._winCount,
      losses: this._evaluatedCount - this._winCount,
    };
  }

  /**
   * @returns {Object[]} stored entries in chronological order (oldest first),
   *   including HOLD entries, up to `maxSize`.
   */
  getHistory() {
    if (this._size === 0) return [];

    const out = [];
    // Oldest entry sits at `_head` once the buffer has wrapped; before that
    // it's simply index 0, since nothing has been evicted yet.
    const start = this._size < this.maxSize ? 0 : this._head;

    for (let i = 0; i < this._size; i++) {
      out.push(this._buffer[(start + i) % this.maxSize]);
    }
    return out;
  }

  /** @returns {number} number of signals currently stored (<= maxSize). */
  size() {
    return this._size;
  }

  /** Clear all stored signals and reset aggregates. */
  reset() {
    this._buffer = new Array(this.maxSize).fill(null);
    this._head = 0;
    this._size = 0;
    this._evaluatedCount = 0;
    this._winCount = 0;
    this._profitSum = 0;
  }

  /** Internal: uppercase + validate the signal label. */
  _normalizeSignal(signal) {
    const normalized = String(signal ?? '').toUpperCase();
    if (!VALID_SIGNALS.has(normalized)) {
      throw new Error(
        `PerformanceEngine.recordSignal: signal must be one of BUY/SELL/HOLD, got "${signal}".`
      );
    }
    return normalized;
  }

  /**
   * Internal: % profit for a directional signal, or null if the signal
   * doesn't represent a position (HOLD).
   *   BUY  -> profits when price rises
   *   SELL -> profits when price falls
   */
  _computePnlPercent(signal, entryPrice, currentPrice) {
    if (signal === 'BUY') return ((currentPrice - entryPrice) / entryPrice) * 100;
    if (signal === 'SELL') return ((entryPrice - currentPrice) / entryPrice) * 100;
    return null; // HOLD
  }

  /** Internal: fold an entry's outcome into the running aggregates. */
  _addToAggregates(entry) {
    if (entry.pnl_percent === null) return;
    this._evaluatedCount++;
    this._profitSum += entry.pnl_percent;
    if (entry.is_win) this._winCount++;
  }

  /** Internal: remove an evicted entry's outcome from the running aggregates. */
  _removeFromAggregates(entry) {
    if (entry.pnl_percent === null) return;
    this._evaluatedCount--;
    this._profitSum -= entry.pnl_percent;
    if (entry.is_win) this._winCount--;
  }
}

export default PerformanceEngine;
export { PerformanceEngine };
