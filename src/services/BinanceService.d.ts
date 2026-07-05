/** on/off/emit only — matches the dependency-free MiniEmitter used at runtime. */
export interface MiniEmitter {
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
}

export interface MarketSnapshot {
  symbol: string;
  price: number;
  change_24h: number;
  volume: number;
  high_24h: number;
  low_24h: number;
  timestamp: number;
}

export interface BinanceServiceOptions {
  symbols?: string[];
  intervalMs?: number;
  timeoutMs?: number;
}

export declare class BinanceService implements MiniEmitter {
  symbols: string[];
  intervalMs: number;
  constructor(options?: BinanceServiceOptions);
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
  start(): void;
  stop(): void;
  isRunning(): boolean;
  getSnapshot(symbol: string): MarketSnapshot | null;
  getAllSnapshots(): MarketSnapshot[];
}

export declare const DEFAULT_SYMBOLS: string[];
export declare const DEFAULT_INTERVAL_MS: number;

export default BinanceService;
