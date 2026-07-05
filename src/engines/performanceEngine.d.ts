export type TrackedSignal = 'BUY' | 'SELL' | 'HOLD';

export interface PerformanceSignalInput {
  signal: TrackedSignal;
  entry_price: number;
  current_price: number;
}

export interface PerformanceEntry extends PerformanceSignalInput {
  pnl_percent: number | null;
  is_win: boolean | null;
  timestamp: number;
}

export interface PerformanceSnapshot {
  success_rate: number;
  avg_profit: number;
  total_trades: number;
}

export interface PerformanceEngineOptions {
  maxSize?: number;
}

export declare class PerformanceEngine {
  maxSize: number;
  constructor(options?: PerformanceEngineOptions);
  recordSignal(record: PerformanceSignalInput): PerformanceEntry;
  getPerformance(): PerformanceSnapshot;
  getWinLoss(): { wins: number; losses: number };
  getHistory(): PerformanceEntry[];
  size(): number;
  reset(): void;
}

export default PerformanceEngine;
