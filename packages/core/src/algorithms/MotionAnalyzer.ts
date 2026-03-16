// ─────────────────────────────────────────────────────────────
// @seizure-watch/core — algorithms/MotionAnalyzer.ts
// Procesamiento de señal de acelerómetro/giroscopio.
// Detecta patrones motores de crisis epilépticas.
// ─────────────────────────────────────────────────────────────

import {
  Vector3D,
  SensorReading,
  SeizureType,
  SensitivityProfile,
  DEFAULT_SENSITIVITY,
} from '../models/types';

export interface MotionAnalysisResult {
  isMotionEvent: boolean;
  seizureType: SeizureType | null;
  confidence: number;
  sma: number;
  dominantFreqHz: number;
  zeroCrossingRate: number;
  peakMagnitude: number;
  asymmetryScore: number;
  isTonic: boolean;
}

export class MotionAnalyzer {
  private readonly windowSize: number;
  private readonly samplingRateHz: number;
  private buffer: SensorReading[] = [];
  private sensitivity: SensitivityProfile;

  constructor(
    windowSizeSeconds = 10,
    samplingRateHz = 50,
    sensitivity: SensitivityProfile = DEFAULT_SENSITIVITY
  ) {
    this.windowSize    = windowSizeSeconds * samplingRateHz;
    this.samplingRateHz = samplingRateHz;
    this.sensitivity   = sensitivity;
  }

  updateSensitivity(s: SensitivityProfile): void {
    this.sensitivity = s;
  }

  pushSample(reading: SensorReading): void {
    this.buffer.push(reading);
    if (this.buffer.length > this.windowSize) this.buffer.shift();
  }

  analyze(): MotionAnalysisResult {
    if (this.buffer.length < this.windowSize * 0.5) return this.emptyResult();

    const magnitudes    = this.buffer.map(r => this.magnitude(r.accelerometer));
    const sma           = this.computeSMA(this.buffer);
    const zcr           = this.zeroCrossingRate(magnitudes);
    const dominantFreq  = this.estimateDominantFrequency(magnitudes);
    const peakMag       = Math.max(...magnitudes);
    const asymmetry     = this.computeAsymmetry(this.buffer);
    const isTonic       = this.detectTonicPattern(magnitudes, zcr);

    const { isMotionEvent, seizureType, confidence } =
      this.classify(sma, dominantFreq, zcr, peakMag, asymmetry, isTonic);

    return { isMotionEvent, seizureType, confidence, sma, dominantFreqHz: dominantFreq,
             zeroCrossingRate: zcr, peakMagnitude: peakMag, asymmetryScore: asymmetry, isTonic };
  }

  // ── Algoritmos de señal ──────────────────────────────────

  private computeSMA(readings: SensorReading[]): number {
    const N = readings.length;
    const sum = readings.reduce((acc, r) =>
      acc + Math.abs(r.accelerometer.x)
          + Math.abs(r.accelerometer.y)
          + Math.abs(r.accelerometer.z), 0);
    return sum / N;
  }

  private magnitude(v: Vector3D): number {
    return Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
  }

  private zeroCrossingRate(signal: number[]): number {
    const mean    = signal.reduce((a, b) => a + b, 0) / signal.length;
    const centered = signal.map(v => v - mean);
    let crossings  = 0;
    for (let i = 1; i < centered.length; i++) {
      if (centered[i - 1] * centered[i] < 0) crossings++;
    }
    return (crossings / (2 * signal.length)) * this.samplingRateHz;
  }

  private estimateDominantFrequency(signal: number[]): number {
    const N       = signal.length;
    const mean    = signal.reduce((a, b) => a + b, 0) / N;
    const centered = signal.map(v => v - mean);
    const minLag  = Math.floor(this.samplingRateHz / 25);
    const maxLag  = Math.floor(this.samplingRateHz / 2);
    let bestLag = 0, bestCorr = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < N - lag; i++) corr += centered[i] * centered[i + lag];
      corr /= (N - lag);
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }

    return bestLag > 0 ? this.samplingRateHz / bestLag : 0;
  }

  private computeAsymmetry(readings: SensorReading[]): number {
    const eX = readings.reduce((a, r) => a + r.accelerometer.x ** 2, 0);
    const eY = readings.reduce((a, r) => a + r.accelerometer.y ** 2, 0);
    const eZ = readings.reduce((a, r) => a + r.accelerometer.z ** 2, 0);
    const total = eX + eY + eZ;
    return total === 0 ? 0 : Math.max(eX, eY, eZ) / total;
  }

  private detectTonicPattern(magnitudes: number[], zcr: number): boolean {
    const ratio = magnitudes.filter(m => m > this.sensitivity.motionThresholdG).length
                  / magnitudes.length;
    return ratio > 0.7 && zcr < this.sensitivity.minTremorFreqHz;
  }

  // ── Clasificador ─────────────────────────────────────────

  private classify(
    sma: number, freqHz: number, zcr: number,
    peakMag: number, asymmetry: number, isTonic: boolean
  ): { isMotionEvent: boolean; seizureType: SeizureType | null; confidence: number } {
    const { motionThresholdG, minTremorFreqHz, maxTremorFreqHz } = this.sensitivity;

    if (sma < motionThresholdG * 0.5 && peakMag < motionThresholdG)
      return { isMotionEvent: false, seizureType: null, confidence: 0 };

    let confidence = 0;
    let seizureType: SeizureType | null = null;

    if (isTonic && peakMag > motionThresholdG * 2) {
      confidence  = this.normalize(peakMag, motionThresholdG * 2, motionThresholdG * 5);
      seizureType = SeizureType.TONIC;
    }

    if (sma > motionThresholdG && freqHz >= minTremorFreqHz
        && freqHz <= maxTremorFreqHz && asymmetry < 0.7) {
      const c = this.normalize(sma, motionThresholdG, motionThresholdG * 4) * 0.6
              + this.normalize(Math.abs(freqHz - 6), 0, 10, true) * 0.4;
      if (c > confidence) { confidence = c; seizureType = SeizureType.TONIC_CLONIC; }
    }

    if (peakMag > motionThresholdG * 3 && zcr > 8 && sma < motionThresholdG * 2) {
      const c = this.normalize(peakMag, motionThresholdG * 3, motionThresholdG * 6);
      if (c > confidence) { confidence = c; seizureType = SeizureType.MYOCLONIC; }
    }

    if (freqHz >= minTremorFreqHz && freqHz <= maxTremorFreqHz && asymmetry > 0.65) {
      const c = (asymmetry - 0.65) / 0.35 * 0.8;
      if (c > confidence) { confidence = c; seizureType = SeizureType.FOCAL_MOTOR; }
    }

    return { isMotionEvent: confidence > 0.35, seizureType,
             confidence: Math.min(confidence, 1) };
  }

  private normalize(value: number, min: number, max: number, invert = false): number {
    const n = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return invert ? 1 - n : n;
  }

  private emptyResult(): MotionAnalysisResult {
    return { isMotionEvent: false, seizureType: null, confidence: 0,
             sma: 0, dominantFreqHz: 0, zeroCrossingRate: 0,
             peakMagnitude: 0, asymmetryScore: 0, isTonic: false };
  }

  getBuffer(): SensorReading[] { return [...this.buffer]; }
  clearBuffer(): void          { this.buffer = []; }
}
