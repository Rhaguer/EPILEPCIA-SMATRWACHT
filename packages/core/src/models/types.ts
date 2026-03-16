// ─────────────────────────────────────────────────────────────
// @seizure-watch/core — models/types.ts
// Tipos, interfaces y enumeraciones base del sistema.
// ─────────────────────────────────────────────────────────────

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface SensorReading {
  timestamp: number;
  accelerometer: Vector3D;   // g-force
  gyroscope: Vector3D;       // rad/s
  heartRate: number | null;  // bpm
  skinTemperature?: number;  // °C (opcional)
}

export enum SeizureType {
  TONIC_CLONIC = 'tonic-clonic',
  FOCAL_MOTOR  = 'focal-motor',
  MYOCLONIC    = 'myoclonic',
  TONIC        = 'tonic',
  HR_ANOMALY   = 'hr-anomaly',
  UNKNOWN      = 'unknown',
}

export enum SeizurePhase {
  PREICTAL  = 'preictal',
  ICTAL     = 'ictal',
  POSTICTAL = 'postictal',
}

export interface SeizureEvent {
  id: string;
  patientId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  type: SeizureType;
  phase: SeizurePhase;
  confidence: number;
  peakAcceleration: number;
  avgHeartRate: number;
  peakHeartRate: number;
  motionFrequencyHz: number;
  alertSent: boolean;
  alertTimestamp?: number;
  postalertAcknowledged?: boolean;
  deviceId: string;
  rawSamplesCount: number;
  notes?: string;
}

export interface PatientProfile {
  id: string;
  name: string;
  dateOfBirth: string;
  weightKg: number;
  knownEpilepsyType?: string;
  baselineHeartRate: number;
  baselineHeartRateMax: number;
  caregivers: CaregiverContact[];
  sensitivityProfile: SensitivityProfile;
}

export interface CaregiverContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  priority: number;
  notifyViaSMS: boolean;
  notifyViaPush: boolean;
}

export interface SensitivityProfile {
  motionThresholdG: number;
  minTremorFreqHz: number;
  maxTremorFreqHz: number;
  minSeizureDurationMs: number;
  hrDeltaThresholdBpm: number;
  postictalDetectionEnabled: boolean;
  falsePositiveSuppressionLevel: 'low' | 'medium' | 'high';
}

export const DEFAULT_SENSITIVITY: SensitivityProfile = {
  motionThresholdG: 1.5,
  minTremorFreqHz: 3,
  maxTremorFreqHz: 20,
  minSeizureDurationMs: 10_000,
  hrDeltaThresholdBpm: 30,
  postictalDetectionEnabled: true,
  falsePositiveSuppressionLevel: 'medium',
};

export interface DetectionResult {
  isSeizureDetected: boolean;
  type: SeizureType;
  confidence: number;
  motionScore: number;
  hrScore: number;
  frequencyHz: number;
  phase: SeizurePhase;
  rawMetrics: {
    sma: number;
    zeroCrossingRate: number;
    hrDelta: number;
    dominantFreq: number;
  };
}

export interface AlertPayload {
  eventId: string;
  patientName: string;
  patientId: string;
  timestamp: number;
  seizureType: SeizureType;
  confidence: number;
  durationMs?: number;
  location?: GeolocationCoords;
  message: string;
}

export interface GeolocationCoords {
  lat: number;
  lon: number;
  accuracy?: number;
}

export interface EpisodeRecord extends SeizureEvent {
  createdAt: number;
  syncedToCloud: boolean;
  doctorReviewed: boolean;
}
