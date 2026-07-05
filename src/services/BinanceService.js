/**
 * BinanceService.js
 * ------------------------------------------------------------------
 * Polls Binance's public 24hr ticker REST endpoint on a fixed interval
 * and emits normalized market data for a configurable set of symbols.
 *
 * Public API:
 *   const service = new BinanceService();
 *   service.on('update', (snapshots) => { ... });   // array of all symbols
 *   service.on('tick', (snapshot) => { ... });       // one symbol at a time
 *   service.on('error', (err) => { ... });
 *   service.start();
 *   service.stop();
 *   service.getSnapshot('BTCUSDT');
 *   service.getAllSnapshots();
 * ------------------------------------------------------------------
 */

/**
 * Minimal EventEmitter (on/off/emit only) with zero dependencies.
 * Avoids importing Node's built-in 'events' module, which bundlers like
 * Vite/Rollup externalize to an empty stub for browser builds — extending
 * it there would throw at build time. This keeps BinanceService usable
 * unmodified in Node, browsers, and any bundler.
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
    [...list].forEach((listener) => listener(...args)); // copy: safe if a listener unsubscribes mid-emit
    return true;
  }
}

const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/24hr';
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
const DEFAULT_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CONSECUTIVE_FAILURES = 5;

class BinanceService extends MiniEmitter {
  /**
   * @param {Object} [options]
   * @param {string[]} [options.symbols] - Symbols to track (e.g. ['BTCUSDT']).
   * @param {number} [options.intervalMs] - Poll interval in milliseconds.
   * @param {number} [options.timeoutMs] - Per-request timeout in milliseconds.
   */
  constructor(options = {}) {
    super();
    this.symbols = (options.symbols ?? DEFAULT_SYMBOLS).map((s) => s.toUpperCase());
    this.symbolSet = new Set(this.symbols);
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

    this._timer = null;
    this._isPolling = false;
    this._consecutiveFailures = 0;
    this._cache = new Map(); // symbol -> latest snapshot
  }

  /** Start polling immediately, then every `intervalMs`. */
  start() {
    if (this._timer) return; // already running
    this._poll(); // fire immediately so consumers don't wait a full interval
    this._timer = setInterval(() => this._poll(), this.intervalMs);
  }

  /** Stop polling. Safe to call multiple times. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** @returns {boolean} whether the service is currently polling. */
  isRunning() {
    return this._timer !== null;
  }

  /** @param {string} symbol @returns {object|null} latest snapshot for a symbol. */
  getSnapshot(symbol) {
    return this._cache.get(symbol.toUpperCase()) ?? null;
  }

  /** @returns {object[]} latest snapshots for all tracked symbols. */
  getAllSnapshots() {
    return this.symbols.map((s) => this._cache.get(s)).filter(Boolean);
  }

  /** Internal: fetch + filter + normalize + emit. Never throws. */
  async _poll() {
    if (this._isPolling) return; // avoid overlapping requests if one is slow
    this._isPolling = true;

    try {
      const raw = await this._fetchTicker();
      const snapshots = this._normalize(raw);

      if (snapshots.length === 0) {
        throw new Error('No matching symbols returned by Binance API.');
      }

      this._consecutiveFailures = 0;

      for (const snapshot of snapshots) {
        this._cache.set(snapshot.symbol, snapshot);
        this.emit('tick', snapshot);
      }

      this.emit('update', this.getAllSnapshots());
    } catch (err) {
      this._consecutiveFailures += 1;
      this.emit('error', {
        message: err.message,
        consecutiveFailures: this._consecutiveFailures,
        timestamp: Date.now(),
      });

      if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.emit('degraded', {
          message: `Binance polling failed ${this._consecutiveFailures} times in a row.`,
        });
      }
    } finally {
      this._isPolling = false;
    }
  }

  /** Internal: raw HTTP call with timeout protection. */
  async _fetchTicker() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(BINANCE_TICKER_URL, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`Binance API responded with status ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Internal: filter to tracked symbols and map to the documented shape:
   *   { symbol, price, change_24h, volume }
   */
  _normalize(rawTickers) {
    if (!Array.isArray(rawTickers)) return [];

    return rawTickers
      .filter((t) => this.symbolSet.has(t.symbol))
      .map((t) => ({
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        change_24h: parseFloat(t.priceChangePercent),
        volume: parseFloat(t.volume),
        high_24h: parseFloat(t.highPrice),
        low_24h: parseFloat(t.lowPrice),
        timestamp: Date.now(),
      }));
  }
}

export default BinanceService;
export { BinanceService, DEFAULT_SYMBOLS, DEFAULT_INTERVAL_MS };
