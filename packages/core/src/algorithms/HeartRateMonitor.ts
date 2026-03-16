// ─────────────────────────────────────────────────────────────
// @seizure-watch/core — algorithms/HeartRateMonitor.ts
// Análisis de frecuencia cardíaca en tiempo real.
// ─────────────────────────────────────────────────────────────

import { SensitivityProfile, DEFAULT_SENSITIVITY } from '../models/types';

export interface HRAnalysisResult {
  isHRAnomaly: boolean;
  isTachycardia: boolean;
  isBradycardia: boolean;
  isPostictalPattern: boolean;
  isSudepRisk: boolean;
  currentHR: number;
  baselineHR: number;
  hrDelta: number;
  hrTrend: 'rising' | 'falling' | 'stable';
  confidence: number;
  hrvScore: number | null;
}

export class HeartRateMonitor {
  private hrBuffer: { timestamp: number; bpm: number }[] = [];
  private baselineHR: number;
  private readonly bufferWindowMs   = 60_000;
  private readonly baselineWindowMs = 300_000;
  private sensitivity: SensitivityProfile;

  private readonly TACHYCARDIA_ABSOLUTE_MIN = 100;
  private readonly BRADYCARDIA_ABSOLUTE_MAX = 50;
  private readonly SUDEP_RISK_THRESHOLD     = 40;

  constructor(
    initialBaseline = 80,
    sensitivity: SensitivityProfile = DEFAULT_SENSITIVITY
  ) {
    this.baselineHR  = initialBaseline;
    this.sensitivity = sensitivity;
  }

  updateSensitivity(s: SensitivityProfile): void { this.sensitivity = s; }
  setBaseline(bpm: number): void                 { this.baselineHR = bpm; }
  getBaseline(): number                          { return this.baselineHR; }
  getBufferSize(): number                        { return this.hrBuffer.length; }

  pushReading(timestamp: number, bpm: number): void {
    if (bpm < 20 || bpm > 300) return;
    this.hrBuffer.push({ timestamp, bpm });
    const cutoff = timestamp - this.bufferWindowMs;
    this.hrBuffer = this.hrBuffer.filter(r => r.timestamp >= cutoff);
    this.updateBaseline();
  }

  analyze(isMotionDetected = false): HRAnalysisResult {
    if (this.hrBuffer.length === 0) return this.emptyResult();

    const recent    = this.getRecentReadings(10_000);
    const currentHR = this.average(recent.map(r => r.bpm));
    const hrDelta   = currentHR - this.baselineHR;
    const trend     = this.computeTrend();
    const hrv       = this.computeHRV(recent);

    const isTachycardia = currentHR >= this.TACHYCARDIA_ABSOLUTE_MIN
                       && hrDelta   >= this.sensitivity.hrDeltaThresholdBpm;
    const isBradycardia = currentHR <= this.BRADYCARDIA_ABSOLUTE_MAX;
    const isPostictalPattern = trend === 'falling' && hrDelta < -15
                            && this.hadRecentTachycardia();
    const isSudepRisk = currentHR <= this.SUDEP_RISK_THRESHOLD && isPostictalPattern;
    const isHRAnomaly = isTachycardia || isBradycardia || isPostictalPattern;
    const confidence  = this.computeConfidence(hrDelta, isTachycardia, isBradycardia,
                                               isMotionDetected);

    return { isHRAnomaly, isTachycardia, isBradycardia, isPostictalPattern, isSudepRisk,
             currentHR: Math.round(currentHR), baselineHR: Math.round(this.baselineHR),
             hrDelta: Math.round(hrDelta), hrTrend: trend, confidence, hrvScore: hrv };
  }

  // ── Privados ─────────────────────────────────────────────

  private updateBaseline(): void {
    const window = this.getRecentReadings(this.baselineWindowMs);
    if (window.length < 10) return;
    if (this.stdDev(window.map(r => r.bpm)) < 8)
      this.baselineHR = this.baselineHR * 0.8 + this.average(window.map(r => r.bpm)) * 0.2;
  }

  private hadRecentTachycardia(): boolean {
    return this.getRecentReadings(120_000)
               .some(r => r.bpm >= this.TACHYCARDIA_ABSOLUTE_MIN);
  }

  private computeTrend(): 'rising' | 'falling' | 'stable' {
    if (this.hrBuffer.length < 6) return 'stable';
    const recent = this.getRecentReadings(20_000).map(r => r.bpm);
    if (recent.length < 4) return 'stable';
    const half  = Math.floor(recent.length / 2);
    const diff  = this.average(recent.slice(half)) - this.average(recent.slice(0, half));
    return diff > 8 ? 'rising' : diff < -8 ? 'falling' : 'stable';
  }

  private computeHRV(readings: { bpm: number }[]): number | null {
    if (readings.length < 5) return null;
    const rr   = readings.map(r => 60_000 / r.bpm);
    const diffs = [];
    for (let i = 1; i < rr.length; i++) diffs.push((rr[i] - rr[i - 1]) ** 2);
    return Math.round(Math.sqrt(diffs.reduce((a, b) => a + b, 0) / diffs.length));
  }

  private computeConfidence(
    delta: number, isTachy: boolean, isBrady: boolean, hasMotion: boolean
  ): number {
    let score = 0;
    if (isTachy)              score += this.clamp(delta / 60, 0, 0.6);
    if (isBrady)              score += 0.5;
    if (isTachy && !hasMotion) score += 0.2;
    return Math.min(score, 1);
  }

  private getRecentReadings(windowMs: number) {
    const now = this.hrBuffer.length > 0
      ? this.hrBuffer[this.hrBuffer.length - 1].timestamp : Date.now();
    return this.hrBuffer.filter(r => r.timestamp >= now - windowMs);
  }

  private average(arr: number[]): number {
    return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private stdDev(arr: number[]): number {
    const avg     = this.average(arr);
    const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }

  private emptyResult(): HRAnalysisResult {
    return { isHRAnomaly: false, isTachycardia: false, isBradycardia: false,
             isPostictalPattern: false, isSudepRisk: false, currentHR: 0,
             baselineHR: this.baselineHR, hrDelta: 0, hrTrend: 'stable',
             confidence: 0, hrvScore: null };
  }
}
