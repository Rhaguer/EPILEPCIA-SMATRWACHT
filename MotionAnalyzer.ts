// ============================================================
// MOTION ANALYZER
// Procesa señales de acelerómetro/giroscopio en tiempo real
// para detectar patrones motores de crisis epilépticas.
//
// Tipos detectables:
//  • Tónico-clónicas (3–20 Hz, alta amplitud, bilateral)
//  • Mioclónicas (sacudidas breves >3g)
//  • Tónicas (rigidez: alta magnitud, baja oscilación rítmica)
//  • Focales motoras (asimetría entre ejes x/y)
// ============================================================

import { Vector3D, SensorReading, SeizureType, SensitivityProfile, DEFAULT_SENSITIVITY } from '../models/types';

export interface MotionAnalysisResult {
  isMotionEvent: boolean;
  seizureType: SeizureType | null;
  confidence: number;
  sma: number;                  // Signal Magnitude Area (g)
  dominantFreqHz: number;       // Frecuencia dominante estimada
  zeroCrossingRate: number;     // Tasa de cruces por cero (proxy de frecuencia)
  peakMagnitude: number;        // Magnitud pico (g)
  asymmetryScore: number;       // 0–1: 0 = bilateral, 1 = totalmente unilateral
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
    this.windowSize = windowSizeSeconds * samplingRateHz;
    this.samplingRateHz = samplingRateHz;
    this.sensitivity = sensitivity;
  }

  updateSensitivity(s: SensitivityProfile) {
    this.sensitivity = s;
  }

  // Agrega una nueva muestra al buffer deslizante
  pushSample(reading: SensorReading): void {
    this.buffer.push(reading);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
  }

  // Analiza el buffer actual y retorna resultado
  analyze(): MotionAnalysisResult {
    if (this.buffer.length < this.windowSize * 0.5) {
      return this.emptyResult();
    }

    const magnitudes = this.buffer.map(r => this.magnitude(r.accelerometer));
    const sma = this.computeSMA(this.buffer);
    const zcr = this.zeroCrossingRate(magnitudes);
    const dominantFreq = this.estimateDominantFrequency(magnitudes);
    const peakMag = Math.max(...magnitudes);
    const asymmetry = this.computeAsymmetry(this.buffer);
    const isTonic = this.detectTonicPattern(magnitudes, zcr);

    const { isMotionEvent, seizureType, confidence } = this.classify(
      sma, dominantFreq, zcr, peakMag, asymmetry, isTonic
    );

    return {
      isMotionEvent,
      seizureType,
      confidence,
      sma,
      dominantFreqHz: dominantFreq,
      zeroCrossingRate: zcr,
      peakMagnitude: peakMag,
      asymmetryScore: asymmetry,
      isTonic,
    };
  }

  // ─── Algoritmos de señal ────────────────────────────────

  // Signal Magnitude Area: suma de integrales absolutas por eje
  private computeSMA(readings: SensorReading[]): number {
    const N = readings.length;
    const sum = readings.reduce((acc, r) => {
      return acc + Math.abs(r.accelerometer.x)
                 + Math.abs(r.accelerometer.y)
                 + Math.abs(r.accelerometer.z);
    }, 0);
    return sum / N;
  }

  // Magnitud euclidiana de un vector
  private magnitude(v: Vector3D): number {
    return Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
  }

  // Tasa de cruces por cero (Zero Crossing Rate)
  // Proxy de frecuencia: mayor ZCR → movimiento más oscilatorio
  private zeroCrossingRate(signal: number[]): number {
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const centered = signal.map(v => v - mean);
    let crossings = 0;
    for (let i = 1; i < centered.length; i++) {
      if (centered[i - 1] * centered[i] < 0) crossings++;
    }
    return (crossings / (2 * signal.length)) * this.samplingRateHz; // Hz
  }

  // Estimación de frecuencia dominante por autocorrelación
  // Más robusta que FFT para señales cortas y ruidosas
  private estimateDominantFrequency(signal: number[]): number {
    const N = signal.length;
    const mean = signal.reduce((a, b) => a + b, 0) / N;
    const centered = signal.map(v => v - mean);

    let bestLag = 0;
    let bestCorr = -Infinity;

    // Busca en rango de lags que corresponden a 2–25 Hz
    const minLag = Math.floor(this.samplingRateHz / 25);
    const maxLag = Math.floor(this.samplingRateHz / 2);

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < N - lag; i++) {
        corr += centered[i] * centered[i + lag];
      }
      corr /= (N - lag);
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    return bestLag > 0 ? this.samplingRateHz / bestLag : 0;
  }

  // Asimetría entre eje X (pronación/supinación) e Y (flexión)
  // Crisis focales unilaterales muestran mayor asimetría
  private computeAsymmetry(readings: SensorReading[]): number {
    const energyX = readings.reduce((a, r) => a + r.accelerometer.x ** 2, 0);
    const energyY = readings.reduce((a, r) => a + r.accelerometer.y ** 2, 0);
    const energyZ = readings.reduce((a, r) => a + r.accelerometer.z ** 2, 0);
    const total = energyX + energyY + energyZ;
    if (total === 0) return 0;
    const dominant = Math.max(energyX, energyY, energyZ);
    return dominant / total; // 0.33 = perfecto bilateral, 1.0 = un solo eje
  }

  // Patrón tónico: alta magnitud sostenida, ZCR baja (sin oscilación)
  private detectTonicPattern(magnitudes: number[], zcr: number): boolean {
    const highMag = magnitudes.filter(m => m > this.sensitivity.motionThresholdG).length;
    const highMagRatio = highMag / magnitudes.length;
    return highMagRatio > 0.7 && zcr < this.sensitivity.minTremorFreqHz;
  }

  // ─── Clasificador ───────────────────────────────────────

  private classify(
    sma: number,
    freqHz: number,
    zcr: number,
    peakMag: number,
    asymmetry: number,
    isTonic: boolean
  ): { isMotionEvent: boolean; seizureType: SeizureType | null; confidence: number } {

    const { motionThresholdG, minTremorFreqHz, maxTremorFreqHz } = this.sensitivity;

    // Sin movimiento relevante
    if (sma < motionThresholdG * 0.5 && peakMag < motionThresholdG) {
      return { isMotionEvent: false, seizureType: null, confidence: 0 };
    }

    let confidence = 0;
    let seizureType: SeizureType | null = null;

    // ── Patrón tónico
    if (isTonic && peakMag > motionThresholdG * 2) {
      confidence = this.normalize(peakMag, motionThresholdG * 2, motionThresholdG * 5);
      seizureType = SeizureType.TONIC;
    }

    // ── Patrón tónico-clónico
    // Alta SMA + frecuencia en rango epiléptico + bilateral
    if (
      sma > motionThresholdG &&
      freqHz >= minTremorFreqHz &&
      freqHz <= maxTremorFreqHz &&
      asymmetry < 0.7
    ) {
      const smaScore = this.normalize(sma, motionThresholdG, motionThresholdG * 4);
      const freqScore = this.normalize(
        Math.abs(freqHz - 6), 0, 10, true  // más confianza cerca de 6 Hz (pico TC)
      );
      const c = (smaScore * 0.6 + freqScore * 0.4);
      if (c > confidence) {
        confidence = c;
        seizureType = SeizureType.TONIC_CLONIC;
      }
    }

    // ── Patrón mioclónico
    // Picos muy altos pero corta duración (ZCR alta, SMA moderada)
    if (peakMag > motionThresholdG * 3 && zcr > 8 && sma < motionThresholdG * 2) {
      const c = this.normalize(peakMag, motionThresholdG * 3, motionThresholdG * 6);
      if (c > confidence) {
        confidence = c;
        seizureType = SeizureType.MYOCLONIC;
      }
    }

    // ── Patrón focal motor
    // Frecuencia epiléptica + alta asimetría
    if (
      freqHz >= minTremorFreqHz &&
      freqHz <= maxTremorFreqHz &&
      asymmetry > 0.65
    ) {
      const c = (asymmetry - 0.65) / 0.35 * 0.8;
      if (c > confidence) {
        confidence = c;
        seizureType = SeizureType.FOCAL_MOTOR;
      }
    }

    const isMotionEvent = confidence > 0.35;
    return { isMotionEvent, seizureType, confidence: Math.min(confidence, 1) };
  }

  // Normaliza un valor entre min y max → [0, 1]
  private normalize(value: number, min: number, max: number, invert = false): number {
    const n = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return invert ? 1 - n : n;
  }

  private emptyResult(): MotionAnalysisResult {
    return {
      isMotionEvent: false,
      seizureType: null,
      confidence: 0,
      sma: 0,
      dominantFreqHz: 0,
      zeroCrossingRate: 0,
      peakMagnitude: 0,
      asymmetryScore: 0,
      isTonic: false,
    };
  }

  // Retorna el buffer actual (para depuración / logging)
  getBuffer(): SensorReading[] {
    return [...this.buffer];
  }

  clearBuffer(): void {
    this.buffer = [];
  }
}
