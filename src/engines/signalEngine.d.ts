import type { BinanceService, MiniEmitter, MarketSnapshot } from '../services/BinanceService.js';
import type { PhaseEngine, PhaseAsset } from './phaseEngine.js';

export type SignalLabel = 'BUY' | 'SELL' | 'HOLD';

export interface SignalResult {
  symbol: string;
  phase: number;
  signal: SignalLabel;
  confidence: number;
  timestamp: number;
}

export interface SignalEngineOptions {
  binanceService?: BinanceService;
  phaseEngine?: PhaseEngine;
  symbols?: string[];
  intervalMs?: number;
}

export declare function phaseToSignal(phase: number): SignalLabel;

export declare function generateSignal(
  asset: PhaseAsset | MarketSnapshot,
  phaseEngine?: PhaseEngine
): SignalResult;

export declare const SIGNALS: { BUY: 'BUY'; SELL: 'SELL'; HOLD: 'HOLD' };

export declare class SignalEngine implements MiniEmitter {
  binanceService: BinanceService;
  phaseEngine: PhaseEngine;
  constructor(options?: SignalEngineOptions);
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
  start(): void;
  stop(): void;
  getSignal(symbol: string): SignalResult | null;
  getAllSignals(): SignalResult[];
}

export default SignalEngine;
