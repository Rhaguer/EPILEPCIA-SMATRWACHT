// ============================================================
// RNSensorAdapter.ts
// Adaptador React Native para SeizureWatch.
// Usa react-native-sensors para leer acelerómetro, giroscopio
// y @kingstinct/react-native-healthkit / react-native-health
// para frecuencia cardíaca (iOS/Wear OS).
//
// Instalar dependencias:
//   npm install react-native-sensors
//   npm install react-native-get-random-values  (para uuid)
//   # iOS: pod install
//   # Android: auto-linking
// ============================================================

import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';
import { Subscription } from 'rxjs';
import { map, filter } from 'rxjs/operators';
import { Platform, NativeEventEmitter, NativeModules } from 'react-native';

import { SensorAdapter, SensorReading, Vector3D } from '../seizure-watch/src/models/types';

// ─── Interfaz del módulo nativo de HR ───────────────────────
// Para Wear OS: usa el módulo nativo que se construye en /android
// Para iOS (HealthKit): usa react-native-health
// Se define una interfaz agnóstica aquí:

interface HRModule {
  startMonitoring(intervalMs: number): void;
  stopMonitoring(): void;
  addListener(event: string, callback: (bpm: number) => void): void;
  removeListener(event: string): void;
}

// ─── Configuración del adaptador ────────────────────────────

export interface RNSensorConfig {
  samplingRateHz?: number;         // default 50
  hrUpdateIntervalMs?: number;     // default 1000
  platform?: 'android' | 'ios' | 'auto';
  hrModule?: HRModule;             // inyección para testeo
}

// ─── Adaptador principal ─────────────────────────────────────

export class RNSensorAdapter implements SensorAdapter {
  onReading: ((reading: SensorReading) => void) | null = null;

  private accSubscription: Subscription | null = null;
  private gyroSubscription: Subscription | null = null;
  private hrUnsubscribe: (() => void) | null = null;

  private latestAcc: Vector3D = { x: 0, y: 0, z: 0 };
  private latestGyro: Vector3D = { x: 0, y: 0, z: 0 };
  private latestHR: number | null = null;
  private lastEmittedReading: SensorReading | null = null;

  private active = false;
  private config: Required<RNSensorConfig>;

  // Buffer para sincronizar acc + gyro antes de emitir
  private lastAccTs = 0;
  private lastGyroTs = 0;
  private readonly SYNC_TOLERANCE_MS = 20; // ±20ms entre ejes

  constructor(config: RNSensorConfig = {}) {
    this.config = {
      samplingRateHz: config.samplingRateHz ?? 50,
      hrUpdateIntervalMs: config.hrUpdateIntervalMs ?? 1000,
      platform: config.platform ?? 'auto',
      hrModule: config.hrModule ?? this.detectHRModule(),
    };
  }

  // ─── API SensorAdapter ──────────────────────────────────

  async startSensors(): Promise<void> {
    if (this.active) return;

    const intervalMs = Math.round(1000 / this.config.samplingRateHz);

    // Configurar intervalo de muestreo
    setUpdateIntervalForType(SensorTypes.accelerometer, intervalMs);
    setUpdateIntervalForType(SensorTypes.gyroscope, intervalMs);

    this.startAccelerometer();
    this.startGyroscope();
    this.startHeartRate();

    this.active = true;
    console.log(`[RNSensorAdapter] Sensores activos @ ${this.config.samplingRateHz}Hz`);
  }

  async stopSensors(): Promise<void> {
    this.accSubscription?.unsubscribe();
    this.gyroSubscription?.unsubscribe();
    this.hrUnsubscribe?.();

    this.accSubscription = null;
    this.gyroSubscription = null;
    this.hrUnsubscribe = null;
    this.active = false;

    console.log('[RNSensorAdapter] Sensores detenidos.');
  }

  isActive(): boolean { return this.active; }
  getLastReading(): SensorReading | null { return this.lastEmittedReading; }

  // ─── Acelerómetro ───────────────────────────────────────

  private startAccelerometer(): void {
    this.accSubscription = accelerometer
      .pipe(
        filter(data => data !== null),
        map(data => ({
          // react-native-sensors entrega en m/s² → convertir a g
          x: data.x / 9.81,
          y: data.y / 9.81,
          z: data.z / 9.81,
          timestamp: data.timestamp,
        }))
      )
      .subscribe({
        next: ({ x, y, z, timestamp }) => {
          this.latestAcc = { x, y, z };
          this.lastAccTs = timestamp;
          this.tryEmitReading(timestamp);
        },
        error: (err) => console.error('[RNSensorAdapter] Acc error:', err),
      });
  }

  // ─── Giroscopio ─────────────────────────────────────────

  private startGyroscope(): void {
    this.gyroSubscription = gyroscope
      .pipe(
        filter(data => data !== null),
        map(data => ({
          x: data.x, // ya en rad/s
          y: data.y,
          z: data.z,
          timestamp: data.timestamp,
        }))
      )
      .subscribe({
        next: ({ x, y, z, timestamp }) => {
          this.latestGyro = { x, y, z };
          this.lastGyroTs = timestamp;
          this.tryEmitReading(timestamp);
        },
        error: (err) => console.error('[RNSensorAdapter] Gyro error:', err),
      });
  }

  // ─── Frecuencia cardíaca ────────────────────────────────

  private startHeartRate(): void {
    const hrModule = this.config.hrModule;
    if (!hrModule) {
      console.warn('[RNSensorAdapter] No hay módulo de HR disponible.');
      return;
    }

    try {
      hrModule.startMonitoring(this.config.hrUpdateIntervalMs);
      hrModule.addListener('heartRate', (bpm: number) => {
        if (bpm > 20 && bpm < 300) {
          this.latestHR = bpm;
        }
      });

      this.hrUnsubscribe = () => {
        hrModule.removeListener('heartRate');
        hrModule.stopMonitoring();
      };
    } catch (err) {
      console.warn('[RNSensorAdapter] HR no disponible:', err);
    }
  }

  // ─── Emisión sincronizada ───────────────────────────────

  // Solo emite cuando acc y gyro están temporalmente alineados
  private tryEmitReading(timestamp: number): void {
    const delta = Math.abs(this.lastAccTs - this.lastGyroTs);
    if (delta > this.SYNC_TOLERANCE_MS) return; // espera que ambos estén listos

    const reading: SensorReading = {
      timestamp: Date.now(),
      accelerometer: { ...this.latestAcc },
      gyroscope: { ...this.latestGyro },
      heartRate: this.latestHR,
    };

    this.lastEmittedReading = reading;
    this.onReading?.(reading);
  }

  // ─── Detección automática del módulo HR ────────────────

  private detectHRModule(): HRModule | null {
    const platform = this.config?.platform === 'auto'
      ? Platform.OS
      : this.config?.platform;

    if (platform === 'android') {
      // Wear OS: módulo nativo en /android/app/src/main/java/...
      // Ver WearHeartRateModule.kt en este proyecto
      const native = NativeModules.WearHeartRateModule;
      if (native) return this.wrapAndroidHRModule(native);
    }

    if (platform === 'ios') {
      // Intenta react-native-health si está disponible
      try {
        const AppleHealthKit = require('react-native-health').default;
        return this.wrapAppleHealthKit(AppleHealthKit);
      } catch {
        console.warn('[RNSensorAdapter] react-native-health no instalado.');
      }
    }

    return null;
  }

  // ─── Wrappers de módulos nativos ────────────────────────

  private wrapAndroidHRModule(native: any): HRModule {
    const emitter = new NativeEventEmitter(native);
    const listeners = new Map<string, any>();

    return {
      startMonitoring: (intervalMs) => native.startMonitoring(intervalMs),
      stopMonitoring: () => native.stopMonitoring(),
      addListener: (event, callback) => {
        const sub = emitter.addListener('HeartRateUpdate', (data) => {
          callback(data.bpm);
        });
        listeners.set(event, sub);
      },
      removeListener: (event) => {
        listeners.get(event)?.remove();
        listeners.delete(event);
      },
    };
  }

  private wrapAppleHealthKit(AppleHealthKit: any): HRModule {
    let intervalHandle: ReturnType<typeof setInterval> | null = null;
    const listeners = new Map<string, (bpm: number) => void>();

    return {
      startMonitoring: (intervalMs) => {
        const permissions = {
          permissions: {
            read: [AppleHealthKit.Constants.Permissions.HeartRate],
            write: [],
          },
        };

        AppleHealthKit.initHealthKit(permissions, (err: any) => {
          if (err) {
            console.error('[HealthKit] initHealthKit error:', err);
            return;
          }

          intervalHandle = setInterval(() => {
            const options = {
              unit: 'bpm',
              startDate: new Date(Date.now() - 10_000).toISOString(),
              endDate: new Date().toISOString(),
              limit: 1,
              ascending: false,
            };

            AppleHealthKit.getHeartRateSamples(
              options,
              (err: any, results: any[]) => {
                if (!err && results?.length > 0) {
                  const bpm = results[0].value;
                  listeners.get('heartRate')?.(bpm);
                }
              }
            );
          }, intervalMs);
        });
      },

      stopMonitoring: () => {
        if (intervalHandle) clearInterval(intervalHandle);
      },

      addListener: (event, callback) => {
        listeners.set(event, callback);
      },

      removeListener: (event) => {
        listeners.delete(event);
      },
    };
  }
}
