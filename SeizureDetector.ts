// ============================================================
// SEIZURE DETECTOR — Motor central de fusión de señales
// Combina análisis de movimiento + ritmo cardíaco con una
// máquina de estados para detectar, confirmar y cerrar
// eventos de crisis epilépticas en tiempo real.
//
// Estado:          IDLE → PREICTAL → ICTAL → POSTICTAL → IDLE
// Confirmación:    requiere persistencia N segundos (anti-falso positivo)
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  SensorReading,
  SeizureType,
  SeizurePhase,
  SeizureEvent,
  DetectionResult,
  PatientProfile,
  SensitivityProfile,
  DEFAULT_SENSITIVITY,
} from '../models/types';
import { MotionAnalyzer } from './MotionAnalyzer';
import { HeartRateMonitor } from './HeartRateMonitor';

export type DetectorState = 'IDLE' | 'SUSPECTED' | 'CONFIRMED' | 'POSTICTAL';

export interface DetectorStatus {
  state: DetectorState;
  activeEvent: SeizureEvent | null;
  lastResult: DetectionResult | null;
  suspectedSince: number | null;
  confirmedSince: number | null;
}

export type SeizureCallback = (event: SeizureEvent) => void;
export type StatusCallback  = (status: DetectorStatus) => void;

interface ActivityContext {
  isLikelySleeping: boolean;
  isLikelyExercising: boolean;
  avgMotionLast5Min: number;
}

export class SeizureDetector {
  private state: DetectorState = 'IDLE';
  private motionAnalyzer: MotionAnalyzer;
  private hrMonitor: HeartRateMonitor;
  private profile: PatientProfile;
  private sensitivity: SensitivityProfile;

  private activeEvent: SeizureEvent | null = null;
  private suspectedSince: number | null = null;
  private confirmedSince: number | null = null;
  private postictalSince: number | null = null;
  private lastResult: DetectionResult | null = null;

  // Cuántos ms de señal positiva se necesitan para confirmar
  private readonly CONFIRMATION_DELAY_MS: number;
  // Duración máxima de monitoreo post-ictal
  private readonly POSTICTAL_WINDOW_MS = 300_000; // 5 minutos
  // Tiempo mínimo en POSTICTAL antes de volver a IDLE
  private readonly MIN_POSTICTAL_MS = 30_000;

  // Callbacks para eventos externos
  private onSeizureDetected: SeizureCallback;
  private onSeizureEnded: SeizureCallback;
  private onStatusChange: StatusCallback;
  private onSudepRisk?: (event: SeizureEvent) => void;

  // Contexto de actividad (anti-falso positivo)
  private activityContext: ActivityContext = {
    isLikelySleeping: false,
    isLikelyExercising: false,
    avgMotionLast5Min: 0,
  };

  constructor(
    profile: PatientProfile,
    onSeizureDetected: SeizureCallback,
    onSeizureEnded: SeizureCallback,
    onStatusChange: StatusCallback,
    onSudepRisk?: (event: SeizureEvent) => void,
    samplingRateHz = 50
  ) {
    this.profile = profile;
    this.sensitivity = profile.sensitivityProfile ?? DEFAULT_SENSITIVITY;
    this.onSeizureDetected = onSeizureDetected;
    this.onSeizureEnded = onSeizureEnded;
    this.onStatusChange = onStatusChange;
    this.onSudepRisk = onSudepRisk;

    // Nivel de supresión de falsos positivos → delay de confirmación
    const delayMap = { low: 5_000, medium: 10_000, high: 15_000 };
    this.CONFIRMATION_DELAY_MS = delayMap[this.sensitivity.falsePositiveSuppressionLevel];

    this.motionAnalyzer = new MotionAnalyzer(10, samplingRateHz, this.sensitivity);
    this.hrMonitor = new HeartRateMonitor(profile.baselineHeartRate, this.sensitivity);
    this.hrMonitor.setBaseline(profile.baselineHeartRate);
  }

  // ─── API Principal ──────────────────────────────────────

  // Llamar con cada muestra del sensor (frecuencia: samplingRateHz)
  processSample(reading: SensorReading): void {
    const now = reading.timestamp;

    // Alimentar analizadores
    this.motionAnalyzer.pushSample(reading);
    if (reading.heartRate !== null) {
      this.hrMonitor.pushReading(now, reading.heartRate);
    }

    // Analizar cada ~1 segundo (no cada muestra) para eficiencia
    // En implementación real: usar contador de muestras
    const motionResult = this.motionAnalyzer.analyze();
    const hrResult = this.hrMonitor.analyze(motionResult.isMotionEvent);

    // Fusionar señales
    const detection = this.fuseSignals(motionResult, hrResult);
    this.lastResult = detection;

    // Máquina de estados
    this.updateStateMachine(detection, hrResult, now);

    // Alerta SUDEP independiente del estado principal
    if (hrResult.isSudepRisk && this.activeEvent) {
      this.onSudepRisk?.(this.activeEvent);
    }

    this.emitStatus();
  }

  // ─── Fusión de señales ──────────────────────────────────

  private fuseSignals(
    motion: ReturnType<MotionAnalyzer['analyze']>,
    hr: ReturnType<HeartRateMonitor['analyze']>
  ): DetectionResult {
    const motionConf = motion.isMotionEvent ? motion.confidence : 0;
    const hrConf     = hr.isHRAnomaly ? hr.confidence : 0;

    // Peso de fusión: movimiento domina, HR es corroborador
    // Excepción: taquicardia sin movimiento → solo HR puede disparar (ausencias)
    let fusedConfidence: number;
    let detectedType = motion.seizureType ?? SeizureType.HR_ANOMALY;

    if (motion.isMotionEvent && hr.isHRAnomaly) {
      // Ambas señales positivas → alta confianza
      fusedConfidence = motionConf * 0.65 + hrConf * 0.35;
    } else if (motion.isMotionEvent) {
      // Solo movimiento
      fusedConfidence = motionConf * 0.80;
    } else if (hr.isHRAnomaly && !motion.isMotionEvent) {
      // Solo HR (posible crisis de ausencia / focal no motora)
      fusedConfidence = hrConf * 0.55;
      detectedType = SeizureType.HR_ANOMALY;
    } else {
      fusedConfidence = 0;
    }

    // Ajuste contextual: suprimir si está haciendo ejercicio
    if (this.activityContext.isLikelyExercising && detectedType === SeizureType.HR_ANOMALY) {
      fusedConfidence *= 0.3;
    }

    const phase = this.inferPhase(fusedConfidence, hr);

    return {
      isSeizureDetected: fusedConfidence >= 0.35,
      type: detectedType,
      confidence: Math.min(fusedConfidence, 1),
      motionScore: motionConf,
      hrScore: hrConf,
      frequencyHz: motion.dominantFreqHz,
      phase,
      rawMetrics: {
        sma: motion.sma,
        zeroCrossingRate: motion.zeroCrossingRate,
        hrDelta: hr.hrDelta,
        dominantFreq: motion.dominantFreqHz,
      },
    };
  }

  private inferPhase(
    confidence: number,
    hr: ReturnType<HeartRateMonitor['analyze']>
  ): SeizurePhase {
    if (hr.isPostictalPattern && this.state !== 'IDLE') return SeizurePhase.POSTICTAL;
    if (confidence >= 0.5) return SeizurePhase.ICTAL;
    if (confidence >= 0.25) return SeizurePhase.PREICTAL;
    return SeizurePhase.POSTICTAL;
  }

  // ─── Máquina de estados ─────────────────────────────────

  private updateStateMachine(
    detection: DetectionResult,
    hr: ReturnType<HeartRateMonitor['analyze']>,
    now: number
  ): void {
    switch (this.state) {
      case 'IDLE':
        if (detection.isSeizureDetected) {
          this.state = 'SUSPECTED';
          this.suspectedSince = now;
        }
        break;

      case 'SUSPECTED':
        if (!detection.isSeizureDetected) {
          // Señal perdida antes de confirmación → volver a IDLE
          this.state = 'IDLE';
          this.suspectedSince = null;
          break;
        }
        // ¿Suficiente tiempo de señal positiva para confirmar?
        if (now - (this.suspectedSince ?? now) >= this.CONFIRMATION_DELAY_MS) {
          this.state = 'CONFIRMED';
          this.confirmedSince = now;
          this.activeEvent = this.createEvent(detection, now);
          this.onSeizureDetected(this.activeEvent);
        }
        break;

      case 'CONFIRMED':
        if (this.activeEvent) {
          // Actualiza métricas del evento activo
          this.updateActiveEvent(detection, hr);
        }

        // ¿Señal cedió? → iniciar post-ictal
        if (!detection.isSeizureDetected || hr.isPostictalPattern) {
          this.state = 'POSTICTAL';
          this.postictalSince = now;
          if (this.activeEvent) {
            this.activeEvent.endTime = now;
            this.activeEvent.durationMs = now - this.activeEvent.startTime;
            this.activeEvent.phase = SeizurePhase.POSTICTAL;
          }
        }
        break;

      case 'POSTICTAL':
        const postictalDuration = now - (this.postictalSince ?? now);

        // Detección de nueva crisis durante post-ictal (serie)
        if (detection.isSeizureDetected && detection.confidence > 0.6 &&
            postictalDuration > this.MIN_POSTICTAL_MS) {
          // Nueva crisis — cerrar evento actual y abrir uno nuevo
          if (this.activeEvent) this.onSeizureEnded(this.activeEvent);
          this.state = 'CONFIRMED';
          this.confirmedSince = now;
          this.postictalSince = null;
          this.activeEvent = this.createEvent(detection, now);
          this.onSeizureDetected(this.activeEvent);
          break;
        }

        // Fin del período post-ictal
        if (postictalDuration >= this.POSTICTAL_WINDOW_MS ||
            (!detection.isSeizureDetected && postictalDuration >= this.MIN_POSTICTAL_MS)) {
          if (this.activeEvent) {
            if (!this.activeEvent.endTime) {
              this.activeEvent.endTime = now;
              this.activeEvent.durationMs = now - this.activeEvent.startTime;
            }
            this.onSeizureEnded(this.activeEvent);
          }
          this.state = 'IDLE';
          this.suspectedSince = null;
          this.confirmedSince = null;
          this.postictalSince = null;
          this.activeEvent = null;
        }
        break;
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  private createEvent(detection: DetectionResult, now: number): SeizureEvent {
    return {
      id: uuidv4(),
      patientId: this.profile.id,
      startTime: now,
      endTime: undefined,
      durationMs: undefined,
      type: detection.type,
      phase: SeizurePhase.ICTAL,
      confidence: detection.confidence,
      peakAcceleration: detection.rawMetrics.sma,
      avgHeartRate: this.hrMonitor.analyze().currentHR,
      peakHeartRate: this.hrMonitor.analyze().currentHR,
      motionFrequencyHz: detection.frequencyHz,
      alertSent: false,
      deviceId: 'seizure-watch-v1',
      rawSamplesCount: this.motionAnalyzer.getBuffer().length,
    };
  }

  private updateActiveEvent(
    detection: DetectionResult,
    hr: ReturnType<HeartRateMonitor['analyze']>
  ): void {
    if (!this.activeEvent) return;
    this.activeEvent.confidence = Math.max(this.activeEvent.confidence, detection.confidence);
    this.activeEvent.peakAcceleration = Math.max(
      this.activeEvent.peakAcceleration, detection.rawMetrics.sma
    );
    this.activeEvent.peakHeartRate = Math.max(
      this.activeEvent.peakHeartRate, hr.currentHR
    );
    this.activeEvent.rawSamplesCount += this.motionAnalyzer.getBuffer().length;
  }

  private emitStatus(): void {
    this.onStatusChange({
      state: this.state,
      activeEvent: this.activeEvent,
      lastResult: this.lastResult,
      suspectedSince: this.suspectedSince,
      confirmedSince: this.confirmedSince,
    });
  }

  // ─── API Pública adicional ──────────────────────────────

  updateActivityContext(ctx: Partial<ActivityContext>): void {
    this.activityContext = { ...this.activityContext, ...ctx };
  }

  forceEndEvent(): void {
    if (this.activeEvent) {
      this.activeEvent.endTime = Date.now();
      this.activeEvent.durationMs = Date.now() - this.activeEvent.startTime;
      this.onSeizureEnded(this.activeEvent);
    }
    this.state = 'IDLE';
    this.activeEvent = null;
    this.suspectedSince = null;
    this.confirmedSince = null;
    this.postictalSince = null;
  }

  getState(): DetectorState { return this.state; }
  getActiveEvent(): SeizureEvent | null { return this.activeEvent; }
  getLastResult(): DetectionResult | null { return this.lastResult; }

  updateProfile(profile: Partial<PatientProfile>): void {
    this.profile = { ...this.profile, ...profile };
    if (profile.baselineHeartRate) {
      this.hrMonitor.setBaseline(profile.baselineHeartRate);
    }
  }
}
