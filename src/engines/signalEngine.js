/**
 * signalEngine.js
 * ------------------------------------------------------------------
 * Converts a phase (1-5) into an actionable trading signal and wires
 * together BinanceService -> phaseEngine -> signal in real time.
 *
 * Rules:
 *   phase 1-2  -> BUY
 *   phase 4-5  -> SELL
 *   otherwise (phase 3) -> HOLD
 *
 * Output shape: { symbol, phase, signal, confidence, timestamp }
 *
 * Public API:
 *   import SignalEngine, { generateSignal } from './signalEngine.js';
 *
 *   // Real-time, wired to a live Binance feed:
 *   const engine = new SignalEngine();
 *   engine.on('signal', (signal) => console.log(signal));
 *   engine.start();
 *
 *   // Or compute a one-off signal from any asset snapshot:
 *   const signal = generateSignal(asset);
 * ------------------------------------------------------------------
 */

import BinanceService from '../services/BinanceService.js';
import { PhaseEngine, calculatePhase as calculatePhaseDefault } from './phaseEngine.js';

/**
 * Minimal EventEmitter (on/off/emit only), dependency-free. Mirrors the
 * one in BinanceService.js — avoids importing Node's 'events' module,
 * which bundlers like Vite/Rollup externalize to an empty stub in
 * browser builds (extending it there throws at build time).
 */
class MiniEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(listener);
    return this;
  }

  off(event, listener) {
    const list = this._listeners.get(event);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    }
    return this;
  }

  emit(event, ...args) {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return false;
    [...list].forEach((listener) => listener(...args));
    return true;
  }
}

const SIGNALS = { BUY: 'BUY', SELL: 'SELL', HOLD: 'HOLD' };

/**
 * Pure mapping from phase -> signal label. No side effects, no I/O.
 * @param {number} phase - 1 through 5.
 * @returns {'BUY'|'SELL'|'HOLD'}
 */
function phaseToSignal(phase) {
  if (phase <= 2) return SIGNALS.BUY;
  if (phase >= 4) return SIGNALS.SELL;
  return SIGNALS.HOLD;
}

/**
 * Build a complete signal object for a single asset snapshot.
 * Uses the shared default PhaseEngine instance (rolling history),
 * unless a specific `phaseEngine` instance is supplied.
 *
 * @param {Object} asset - { symbol, price, change_24h, volume, high_24h?, low_24h? }
 * @param {PhaseEngine} [phaseEngine] - Optional dedicated engine instance.
 * @returns {{ symbol: string, phase: number, signal: string, confidence: number, timestamp: number }}
 */
function generateSignal(asset, phaseEngine) {
  const { phase, score } = phaseEngine
    ? phaseEngine.calculatePhase(asset)
    : calculatePhaseDefault(asset);

  return {
    symbol: asset.symbol.toUpperCase(),
    phase,
    signal: phaseToSignal(phase),
    confidence: score, // 0-100, how strong the underlying phase classification is
    timestamp: Date.now(),
  };
}

class SignalEngine extends MiniEmitter {
  /**
   * @param {Object} [options]
   * @param {BinanceService} [options.binanceService] - Inject a custom/mocked instance.
   * @param {PhaseEngine} [options.phaseEngine] - Inject a custom/mocked instance.
   * @param {string[]} [options.symbols] - Symbols to track (used to build the default BinanceService).
   * @param {number} [options.intervalMs] - Poll interval (used to build the default BinanceService).
   */
  constructor(options = {}) {
    super();
    this.binanceService =
      options.binanceService ??
      new BinanceService({ symbols: options.symbols, intervalMs: options.intervalMs });
    this.phaseEngine = options.phaseEngine ?? new PhaseEngine();

    this._signals = new Map(); // symbol -> latest signal
    this._onTick = (asset) => this._handleTick(asset);
    this._onError = (err) => this.emit('error', err);
  }

  /** Start the underlying feed and begin emitting signals on every tick. */
  start() {
    this.binanceService.on('tick', this._onTick);
    this.binanceService.on('error', this._onError);
    this.binanceService.start();
  }

  /** Stop the underlying feed and signal generation. */
  stop() {
    this.binanceService.off('tick', this._onTick);
    this.binanceService.off('error', this._onError);
    this.binanceService.stop();
  }

  /** @param {string} symbol @returns {object|null} latest signal for a symbol. */
  getSignal(symbol) {
    return this._signals.get(symbol.toUpperCase()) ?? null;
  }

  /** @returns {object[]} latest signals for all tracked symbols. */
  getAllSignals() {
    return [...this._signals.values()];
  }

  /** Internal: compute + cache + emit a signal whenever new market data arrives. */
  _handleTick(asset) {
    try {
      const signal = generateSignal(asset, this.phaseEngine);
      this._signals.set(signal.symbol, signal);
      this.emit('signal', signal);
      this.emit('update', this.getAllSignals());
    } catch (err) {
      this.emit('error', { message: err.message, symbol: asset?.symbol, timestamp: Date.now() });
    }
  }
}

export default SignalEngine;
export { SignalEngine, generateSignal, phaseToSignal, SIGNALS };
