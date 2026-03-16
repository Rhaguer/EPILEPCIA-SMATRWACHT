// ============================================================
// HEART RATE MONITOR
// Analiza frecuencia cardíaca en tiempo real para detectar
// anomalías asociadas con crisis epilépticas.
//
// Patrones cardíacos por tipo de crisis:
//  • Tónico-clónica generalizada: taquicardia ictal marcada
//  • Focal con inicio generalizado: taquicardia progresiva
//  • Ausencias: cambios sutiles en HRV (no confiables en wearables)
//  • Post-ictal: bradicardia relativa + desaceleración brusca
//
// SADS (Sudden Arrhythmic Death Syndrome) warning:
//  La bradicardia severa post-ictal es un marcador de riesgo
//  para SUDEP. Se detecta y alerta como emergencia adicional.
// ============================================================

import { SensitivityProfile, DEFAULT_SENSITIVITY } from '../models/types';

export interface HRAnalysisResult {
  isHRAnomaly: boolean;
  isTachycardia: boolean;
  isBradycardia: boolean;
  isPostictalPattern: boolean;
  isSudepRisk: boolean;          // bradicardia severa post-ictal
  currentHR: number;
  baselineHR: number;
  hrDelta: number;               // diferencia vs baseline
  hrTrend: 'rising' | 'falling' | 'stable';
  confidence: number;
  hrvScore: number | null;       // HRV si hay suficientes datos
}

export class HeartRateMonitor {
  private hrBuffer: { timestamp: number; bpm: number }[] = [];
  private baselineHR: number;
  private readonly bufferWindowMs = 60_000;    // 1 minuto
  private readonly baselineWindowMs = 300_000; // 5 minutos para baseline
  private sensitivity: SensitivityProfile;

  // Umbrales pediátricos (< 18 años)
  // Adultos: taquicardia >100, niños: varía por edad
  // Se usa delta sobre baseline para ser agnóstico a edad
  private readonly TACHYCARDIA_ABSOLUTE_MIN = 100; // bpm
  private readonly BRADYCARDIA_ABSOLUTE_MAX = 50;  // bpm
  private readonly SUDEP_RISK_THRESHOLD = 40;      // bpm severo post-ictal

  constructor(
    initialBaseline: number = 80,
    sensitivity: SensitivityProfile = DEFAULT_SENSITIVITY
  ) {
    this.baselineHR = initialBaseline;
    this.sensitivity = sensitivity;
  }

  updateSensitivity(s: SensitivityProfile) {
    this.sensitivity = s;
  }

  pushReading(timestamp: number, bpm: number): void {
    if (bpm < 20 || bpm > 300) return; // Filtra lecturas imposibles

    this.hrBuffer.push({ timestamp, bpm });

    // Limpia lecturas antiguas fuera de ventana
    const cutoff = timestamp - this.bufferWindowMs;
    this.hrBuffer = this.hrBuffer.filter(r => r.timestamp >= cutoff);

    // Actualiza baseline dinámicamente con lecturas "calmas"
    this.updateBaseline(timestamp);
  }

  analyze(isMotionDetected: boolean = false): HRAnalysisResult {
    if (this.hrBuffer.length === 0) {
      return this.emptyResult();
    }

    const recent = this.getRecentReadings(10_000);   // últimos 10s
    const currentHR = this.average(recent.map(r => r.bpm));
    const hrDelta = currentHR - this.baselineHR;
    const trend = this.computeTrend();
    const hrv = this.computeHRV(recent);

    const isTachycardia = (
      currentHR >= this.TACHYCARDIA_ABSOLUTE_MIN &&
      hrDelta >= this.sensitivity.hrDeltaThresholdBpm
    );

    const isBradycardia = currentHR <= this.BRADYCARDIA_ABSOLUTE_MAX;

    // Patrón post-ictal: caída brusca tras taquicardia sostenida
    const isPostictalPattern = (
      trend === 'falling' &&
      hrDelta < -15 &&
      this.hadRecentTachycardia()
    );

    // Riesgo SUDEP: bradicardia severa en contexto post-ictal
    const isSudepRisk = (
      currentHR <= this.SUDEP_RISK_THRESHOLD &&
      isPostictalPattern
    );

    // Taquicardia sin movimiento → sugestivo de crisis focal o ausencia
    const isHRAnomaly = (
      isTachycardia ||
      isBradycardia ||
      isPostictalPattern
    );

    const confidence = this.computeConfidence(
      hrDelta, isTachycardia, isBradycardia, isMotionDetected
    );

    return {
      isHRAnomaly,
      isTachycardia,
      isBradycardia,
      isPostictalPattern,
      isSudepRisk,
      currentHR: Math.round(currentHR),
      baselineHR: Math.round(this.baselineHR),
      hrDelta: Math.round(hrDelta),
      hrTrend: trend,
      confidence,
      hrvScore: hrv,
    };
  }

  // ─── Métodos privados ───────────────────────────────────

  private updateBaseline(now: number): void {
    // Solo actualiza baseline con lecturas "en reposo"
    // (sin pico reciente y con rango estable)
    const window = this.getRecentReadings(this.baselineWindowMs);
    if (window.length < 10) return;

    const bpms = window.map(r => r.bpm);
    const stdev = this.stdDev(bpms);

    // Solo actualiza si la señal es estable (stdev baja → en reposo)
    if (stdev < 8) {
      // Promedio suavizado exponencial
      const newBaseline = this.average(bpms);
      this.baselineHR = this.baselineHR * 0.8 + newBaseline * 0.2;
    }
  }

  private hadRecentTachycardia(): boolean {
    const window = this.getRecentReadings(120_000); // últimos 2 min
    return window.some(r => r.bpm >= this.TACHYCARDIA_ABSOLUTE_MIN);
  }

  private computeTrend(): 'rising' | 'falling' | 'stable' {
    if (this.hrBuffer.length < 6) return 'stable';

    const recent = this.getRecentReadings(20_000).map(r => r.bpm);
    if (recent.length < 4) return 'stable';

    const first = this.average(recent.slice(0, Math.floor(recent.length / 2)));
    const last  = this.average(recent.slice(Math.floor(recent.length / 2)));
    const diff  = last - first;

    if (diff > 8)  return 'rising';
    if (diff < -8) return 'falling';
    return 'stable';
  }

  // HRV simplificado: RMSSD de intervalos RR
  private computeHRV(readings: { bpm: number }[]): number | null {
    if (readings.length < 5) return null;
    const rr = readings.map(r => 60_000 / r.bpm); // ms entre latidos
    const diffs = [];
    for (let i = 1; i < rr.length; i++) {
      diffs.push((rr[i] - rr[i - 1]) ** 2);
    }
    return Math.round(Math.sqrt(diffs.reduce((a, b) => a + b, 0) / diffs.length));
  }

  private computeConfidence(
    delta: number,
    isTachy: boolean,
    isBrady: boolean,
    hasMotion: boolean
  ): number {
    let score = 0;
    if (isTachy) score += this.clamp(delta / 60, 0, 0.6);
    if (isBrady) score += 0.5;
    // Taquicardia SIN movimiento → más sugestivo de causa epiléptica
    if (isTachy && !hasMotion) score += 0.2;
    return Math.min(score, 1);
  }

  private getRecentReadings(windowMs: number): { timestamp: number; bpm: number }[] {
    const now = this.hrBuffer.length > 0
      ? this.hrBuffer[this.hrBuffer.length - 1].timestamp
      : Date.now();
    return this.hrBuffer.filter(r => r.timestamp >= now - windowMs);
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private stdDev(arr: number[]): number {
    const avg = this.average(arr);
    const variance = arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private emptyResult(): HRAnalysisResult {
    return {
      isHRAnomaly: false,
      isTachycardia: false,
      isBradycardia: false,
      isPostictalPattern: false,
      isSudepRisk: false,
      currentHR: 0,
      baselineHR: this.baselineHR,
      hrDelta: 0,
      hrTrend: 'stable',
      confidence: 0,
      hrvScore: null,
    };
  }

  getBaseline(): number { return this.baselineHR; }
  setBaseline(bpm: number): void { this.baselineHR = bpm; }
  getBufferSize(): number { return this.hrBuffer.length; }
}
