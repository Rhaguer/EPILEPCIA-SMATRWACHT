// ============================================================
// SEIZURE WATCH — Punto de entrada principal
// Orquesta detector, alertas y logger en un objeto unificado.
// ============================================================

import {
  PatientProfile,
  SeizureEvent,
  DEFAULT_SENSITIVITY,
} from './models/types';
import { SeizureDetector, DetectorState, DetectorStatus } from './core/SeizureDetector';
import { AlertService, AlertServiceConfig } from './services/AlertService';
import { EpisodeLogger, StorageAdapter } from './services/EpisodeLogger';
import { SensorAdapter, SimulatedSensorAdapter } from './adapters/SensorAdapter';

export interface SeizureWatchConfig {
  profile: PatientProfile;
  alertConfig: AlertServiceConfig;
  sensorAdapter?: SensorAdapter;
  storageAdapter?: StorageAdapter;
  samplingRateHz?: number;
  getLocation?: () => Promise<{ lat: number; lon: number } | null>;
  onStatusChange?: (status: DetectorStatus) => void;
  onSeizureDetected?: (event: SeizureEvent) => void;
  onSeizureEnded?: (event: SeizureEvent) => void;
}

export class SeizureWatch {
  private detector: SeizureDetector;
  private alertService: AlertService;
  private logger: EpisodeLogger;
  private sensor: SensorAdapter;
  private profile: PatientProfile;
  private running = false;

  constructor(config: SeizureWatchConfig) {
    this.profile = config.profile;

    const getLocation = config.getLocation ?? (() => Promise.resolve(null));

    this.logger = new EpisodeLogger(
      config.profile.id,
      config.storageAdapter
    );

    this.alertService = new AlertService(config.alertConfig, getLocation);

    this.detector = new SeizureDetector(
      config.profile,

      // onSeizureDetected
      async (event) => {
        console.log('[SeizureWatch] 🚨 Crisis detectada:', event.type, `confianza: ${Math.round(event.confidence * 100)}%`);
        config.onSeizureDetected?.(event);
        event.alertSent = true;
        event.alertTimestamp = Date.now();
        await this.alertService.sendSeizureAlert(event, this.profile);
        await this.logger.logEpisode(event);
      },

      // onSeizureEnded
      async (event) => {
        console.log('[SeizureWatch] ✅ Crisis finalizada. Duración:', event.durationMs, 'ms');
        config.onSeizureEnded?.(event);
        await this.logger.updateEpisode(event.id, {
          endTime: event.endTime,
          durationMs: event.durationMs,
        });
        await this.alertService.sendSeizureEndedAlert(event, this.profile);
      },

      // onStatusChange
      (status) => config.onStatusChange?.(status),

      // onSudepRisk
      async (event) => {
        console.warn('[SeizureWatch] ⚠️ Riesgo SUDEP detectado!');
        await this.alertService.sendSudepRiskAlert(event, this.profile);
      },

      config.samplingRateHz ?? 50
    );

    this.sensor = config.sensorAdapter ?? new SimulatedSensorAdapter(
      config.samplingRateHz ?? 50
    );

    // Conectar sensor al detector
    this.sensor.onReading = (reading) => {
      this.detector.processSample(reading);
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.logger.initialize();
    await this.sensor.startSensors();
    this.running = true;
    console.log('[SeizureWatch] Sistema activo para paciente:', this.profile.name);
  }

  async stop(): Promise<void> {
    await this.sensor.stopSensors();
    this.running = false;
    console.log('[SeizureWatch] Sistema detenido.');
  }

  getState(): DetectorState { return this.detector.getState(); }
  getActiveEvent(): SeizureEvent | null { return this.detector.getActiveEvent(); }
  getEpisodeHistory() { return this.logger.getAllEpisodes(); }
  getStats() { return this.logger.computeStats(); }
  generateReport(days?: number) { return this.logger.generateMedicalReport(days); }
  isRunning(): boolean { return this.running; }

  acknowledgeAlert(eventId: string, caregiverId: string): void {
    this.alertService.acknowledgeAlert(eventId, caregiverId);
  }

  // Acceso al sensor (para cambiar modo en simulación, etc.)
  getSensor(): SensorAdapter { return this.sensor; }
}

// ─── Exportaciones públicas ─────────────────────────────────

export * from './models/types';
export * from './core/SeizureDetector';
export * from './core/MotionAnalyzer';
export * from './core/HeartRateMonitor';
export * from './services/AlertService';
export * from './services/EpisodeLogger';
export * from './adapters/SensorAdapter';
