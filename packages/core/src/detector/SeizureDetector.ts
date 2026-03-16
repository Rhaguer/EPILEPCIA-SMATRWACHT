// ─────────────────────────────────────────────────────────────
// @seizure-watch/core — detector/SeizureDetector.ts
// Motor central: fusión de señales + máquina de estados.
// IDLE → SUSPECTED → CONFIRMED → POSTICTAL → IDLE
// ─────────────────────────────────────────────────────────────

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
import { MotionAnalyzer }   from '../algorithms/MotionAnalyzer';
import { HeartRateMonitor } from '../algorithms/HeartRateMonitor';

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

  private activeEvent: SeizureEvent | null   = null;
  private suspectedSince: number | null      = null;
  private confirmedSince: number | null      = null;
  private postictalSince: number | null      = null;
  private lastResult: DetectionResult | null = null;

  private readonly CONFIRMATION_DELAY_MS: number;
  private readonly POSTICTAL_WINDOW_MS = 300_000;
  private readonly MIN_POSTICTAL_MS    = 30_000;

  private onSeizureDetected: SeizureCallback;
  private onSeizureEnded:    SeizureCallback;
  private onStatusChange:    StatusCallback;
  private onSudepRisk?:      (event: SeizureEvent) => void;

  private activityContext: ActivityContext = {
    isLikelySleeping: false,
    isLikelyExercising: false,
    avgMotionLast5Min: 0,
  };

  constructor(
    profile: PatientProfile,
    onSeizureDetected: SeizureCallback,
    onSeizureEnded:    SeizureCallback,
    onStatusChange:    StatusCallback,
    onSudepRisk?:      (event: SeizureEvent) => void,
    samplingRateHz = 50
  ) {
    this.profile     = profile;
    this.sensitivity = profile.sensitivityProfile ?? DEFAULT_SENSITIVITY;

    this.onSeizureDetected = onSeizureDetected;
    this.onSeizureEnded    = onSeizureEnded;
    this.onStatusChange    = onStatusChange;
    this.onSudepRisk       = onSudepRisk;

    const delayMap: Record<string, number> = { low: 5_000, medium: 10_000, high: 15_000 };
    this.CONFIRMATION_DELAY_MS = delayMap[this.sensitivity.falsePositiveSuppressionLevel];

    this.motionAnalyzer = new MotionAnalyzer(10, samplingRateHz, this.sensitivity);
    this.hrMonitor      = new HeartRateMonitor(profile.baselineHeartRate, this.sensitivity);
    this.hrMonitor.setBaseline(profile.baselineHeartRate);
  }

  // ── API Principal ────────────────────────────────────────

  processSample(reading: SensorReading): void {
    const now = reading.timestamp;

    this.motionAnalyzer.pushSample(reading);
    if (reading.heartRate !== null)
      this.hrMonitor.pushReading(now, reading.heartRate);

    const motionResult = this.motionAnalyzer.analyze();
    const hrResult     = this.hrMonitor.analyze(motionResult.isMotionEvent);
    const detection    = this.fuseSignals(motionResult, hrResult);
    this.lastResult    = detection;

    this.updateStateMachine(detection, hrResult, now);

    if (hrResult.isSudepRisk && this.activeEvent)
      this.onSudepRisk?.(this.activeEvent);

    this.emitStatus();
  }

  // ── Fusión de señales ────────────────────────────────────

  private fuseSignals(
    motion: ReturnType<MotionAnalyzer['analyze']>,
    hr:     ReturnType<HeartRateMonitor['analyze']>
  ): DetectionResult {
    const motionConf = motion.isMotionEvent ? motion.confidence : 0;
    const hrConf     = hr.isHRAnomaly     ? hr.confidence     : 0;
    let fusedConfidence: number;
    let detectedType = motion.seizureType ?? SeizureType.HR_ANOMALY;

    if (motion.isMotionEvent && hr.isHRAnomaly) {
      fusedConfidence = motionConf * 0.65 + hrConf * 0.35;
    } else if (motion.isMotionEvent) {
      fusedConfidence = motionConf * 0.80;
    } else if (hr.isHRAnomaly && !motion.isMotionEvent) {
      fusedConfidence = hrConf * 0.55;
      detectedType    = SeizureType.HR_ANOMALY;
    } else {
      fusedConfidence = 0;
    }

    if (this.activityContext.isLikelyExercising && detectedType === SeizureType.HR_ANOMALY)
      fusedConfidence *= 0.3;

    const phase = this.inferPhase(fusedConfidence, hr);

    return {
      isSeizureDetected: fusedConfidence >= 0.35,
      type:        detectedType,
      confidence:  Math.min(fusedConfidence, 1),
      motionScore: motionConf,
      hrScore:     hrConf,
      frequencyHz: motion.dominantFreqHz,
      phase,
      rawMetrics: {
        sma:              motion.sma,
        zeroCrossingRate: motion.zeroCrossingRate,
        hrDelta:          hr.hrDelta,
        dominantFreq:     motion.dominantFreqHz,
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

  // ── Máquina de estados ───────────────────────────────────

  private updateStateMachine(
    detection: DetectionResult,
    hr:        ReturnType<HeartRateMonitor['analyze']>,
    now:       number
  ): void {
    switch (this.state) {
      case 'IDLE':
        if (detection.isSeizureDetected) {
          this.state         = 'SUSPECTED';
          this.suspectedSince = now;
        }
        break;

      case 'SUSPECTED':
        if (!detection.isSeizureDetected) {
          this.state          = 'IDLE';
          this.suspectedSince = null;
          break;
        }
        if (now - (this.suspectedSince ?? now) >= this.CONFIRMATION_DELAY_MS) {
          this.state          = 'CONFIRMED';
          this.confirmedSince = now;
          this.activeEvent    = this.createEvent(detection, now);
          this.onSeizureDetected(this.activeEvent);
        }
        break;

      case 'CONFIRMED':
        if (this.activeEvent) this.updateActiveEvent(detection, hr);
        if (!detection.isSeizureDetected || hr.isPostictalPattern) {
          this.state           = 'POSTICTAL';
          this.postictalSince  = now;
          if (this.activeEvent) {
            this.activeEvent.endTime   = now;
            this.activeEvent.durationMs = now - this.activeEvent.startTime;
            this.activeEvent.phase     = SeizurePhase.POSTICTAL;
          }
        }
        break;

      case 'POSTICTAL': {
        const postictalDuration = now - (this.postictalSince ?? now);

        if (detection.isSeizureDetected && detection.confidence > 0.6
            && postictalDuration > this.MIN_POSTICTAL_MS) {
          if (this.activeEvent) this.onSeizureEnded(this.activeEvent);
          this.state          = 'CONFIRMED';
          this.confirmedSince = now;
          this.postictalSince = null;
          this.activeEvent    = this.createEvent(detection, now);
          this.onSeizureDetected(this.activeEvent);
          break;
        }

        if (postictalDuration >= this.POSTICTAL_WINDOW_MS
            || (!detection.isSeizureDetected && postictalDuration >= this.MIN_POSTICTAL_MS)) {
          if (this.activeEvent) {
            if (!this.activeEvent.endTime) {
              this.activeEvent.endTime    = now;
              this.activeEvent.durationMs = now - this.activeEvent.startTime;
            }
            this.onSeizureEnded(this.activeEvent);
          }
          this.state          = 'IDLE';
          this.suspectedSince = null;
          this.confirmedSince = null;
          this.postictalSince = null;
          this.activeEvent    = null;
        }
        break;
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  private createEvent(detection: DetectionResult, now: number): SeizureEvent {
    const hr = this.hrMonitor.analyze();
    return {
      id: uuidv4(), patientId: this.profile.id,
      startTime: now, endTime: undefined, durationMs: undefined,
      type: detection.type, phase: SeizurePhase.ICTAL,
      confidence: detection.confidence,
      peakAcceleration: detection.rawMetrics.sma,
      avgHeartRate: hr.currentHR, peakHeartRate: hr.currentHR,
      motionFrequencyHz: detection.frequencyHz,
      alertSent: false, deviceId: 'seizure-watch-v1',
      rawSamplesCount: this.motionAnalyzer.getBuffer().length,
    };
  }

  private updateActiveEvent(
    detection: DetectionResult,
    hr: ReturnType<HeartRateMonitor['analyze']>
  ): void {
    if (!this.activeEvent) return;
    this.activeEvent.confidence      = Math.max(this.activeEvent.confidence, detection.confidence);
    this.activeEvent.peakAcceleration = Math.max(this.activeEvent.peakAcceleration, detection.rawMetrics.sma);
    this.activeEvent.peakHeartRate   = Math.max(this.activeEvent.peakHeartRate, hr.currentHR);
    this.activeEvent.rawSamplesCount += this.motionAnalyzer.getBuffer().length;
  }

  private emitStatus(): void {
    this.onStatusChange({ state: this.state, activeEvent: this.activeEvent,
                          lastResult: this.lastResult, suspectedSince: this.suspectedSince,
                          confirmedSince: this.confirmedSince });
  }

  // ── API Pública adicional ─────────────────────────────────

  updateActivityContext(ctx: Partial<ActivityContext>): void {
    this.activityContext = { ...this.activityContext, ...ctx };
  }

  forceEndEvent(): void {
    if (this.activeEvent) {
      this.activeEvent.endTime    = Date.now();
      this.activeEvent.durationMs = Date.now() - this.activeEvent.startTime;
      this.onSeizureEnded(this.activeEvent);
    }
    this.state          = 'IDLE';
    this.activeEvent    = null;
    this.suspectedSince = null;
    this.confirmedSince = null;
    this.postictalSince = null;
  }

  getState(): DetectorState            { return this.state; }
  getActiveEvent(): SeizureEvent | null { return this.activeEvent; }
  getLastResult(): DetectionResult | null { return this.lastResult; }

  updateProfile(profile: Partial<PatientProfile>): void {
    this.profile = { ...this.profile, ...profile };
    if (profile.baselineHeartRate)
      this.hrMonitor.setBaseline(profile.baselineHeartRate);
  }
}
