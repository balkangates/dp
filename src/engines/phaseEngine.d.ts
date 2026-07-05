export interface PhaseAsset {
  symbol: string;
  price: number;
  change_24h: number;
  volume: number;
  high_24h?: number;
  low_24h?: number;
}

export interface PhaseResult {
  phase: number; // 1-5
  score: number; // 0-100
}

export interface PhaseEngineOptions {
  historySize?: number;
  volatilityDampingFactor?: number;
}

export declare class PhaseEngine {
  historySize: number;
  constructor(options?: PhaseEngineOptions);
  calculatePhase(asset: PhaseAsset): PhaseResult;
  reset(symbol?: string): void;
}

export declare function calculatePhase(asset: PhaseAsset): PhaseResult;

export default calculatePhase;
