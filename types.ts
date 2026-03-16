// ============================================================
// SEIZURE WATCH — Modelos y tipos base
// Sistema de detección de crisis epilépticas en menores (<18)
// Plataforma: Agnóstico / Adaptable
// ============================================================

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface SensorReading {
  timestamp: number;            // Unix ms
  accelerometer: Vector3D;      // g-force
  gyroscope: Vector3D;          // rad/s
  heartRate: number | null;     // bpm, null si no disponible
  skinTemperature?: number;     // °C, opcional
}

// Tipos de crisis detectables por sensores de consumo
export enum SeizureType {
  TONIC_CLONIC      = 'tonic-clonic',       // Gran mal — alta detectabilidad
  FOCAL_MOTOR       = 'focal-motor',         // Sacudidas unilaterales
  MYOCLONIC         = 'myoclonic',           // Sacudidas breves repetitivas
  TONIC             = 'tonic',               // Rigidez sin sacudidas rítmicas
  HR_ANOMALY        = 'hr-anomaly',          // Solo anomalía cardíaca (ej. ausencias)
  UNKNOWN           = 'unknown',
}

export enum SeizurePhase {
  PREICTAL  = 'preictal',   // Posible aura detectada
  ICTAL     = 'ictal',      // Crisis activa
  POSTICTAL = 'postictal',  // Período post-crisis (letargo, bradicardia)
}

export interface SeizureEvent {
  id: string;
  patientId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  type: SeizureType;
  phase: SeizurePhase;
  confidence: number;           // 0–1
  peakAcceleration: number;     // g
  avgHeartRate: number;         // bpm durante la crisis
  peakHeartRate: number;
  motionFrequencyHz: number;    // frecuencia tremor estimada
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
  dateOfBirth: string;          // ISO 8601
  weightKg: number;
  knownEpilepsyType?: string;   // ej. "Dravet", "JME", "Lennox-Gastaut"
  baselineHeartRate: number;    // bpm promedio en reposo
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
  priority: number;             // 1 = primario
  notifyViaSMS: boolean;
  notifyViaPush: boolean;
}

// Ajuste de sensibilidad por tipo de epilepsia / edad
export interface SensitivityProfile {
  motionThresholdG: number;         // default 1.5g
  minTremorFreqHz: number;          // default 3
  maxTremorFreqHz: number;          // default 20
  minSeizureDurationMs: number;     // default 10_000 ms
  hrDeltaThresholdBpm: number;      // default 30
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
    sma: number;              // Signal Magnitude Area
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
