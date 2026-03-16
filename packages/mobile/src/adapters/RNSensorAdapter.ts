// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — adapters/RNSensorAdapter.ts
// Puente react-native-sensors → motor @seizure-watch/core.
// Soporta Wear OS (módulo nativo Kotlin) y Apple Watch (HealthKit).
// ─────────────────────────────────────────────────────────────

import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';
import { Subscription }                        from 'rxjs';
import { filter, map }                         from 'rxjs/operators';
import { Platform, NativeEventEmitter, NativeModules } from 'react-native';
import type { SensorReading, Vector3D }        from '@seizure-watch/core';

export interface HRModule {
  startMonitoring(intervalMs: number): void;
  stopMonitoring(): void;
  addListener(event: string, callback: (bpm: number) => void): void;
  removeListener(event: string): void;
}

export interface RNSensorConfig {
  samplingRateHz?:    number;   // default 50
  hrUpdateIntervalMs?: number;  // default 1000
  platform?:          'android' | 'ios' | 'auto';
  hrModule?:          HRModule;
}

export class RNSensorAdapter {
  onReading: ((reading: SensorReading) => void) | null = null;

  private accSubscription:   Subscription | null = null;
  private gyroSubscription:  Subscription | null = null;
  private hrUnsubscribe:     (() => void) | null  = null;

  private latestAcc:  Vector3D = { x: 0, y: 0, z: 0 };
  private latestGyro: Vector3D = { x: 0, y: 0, z: 0 };
  private latestHR:   number | null = null;
  private lastEmittedReading: SensorReading | null = null;

  private active = false;
  private config: Required<Omit<RNSensorConfig, 'hrModule'>> & { hrModule: HRModule | null };

  private lastAccTs  = 0;
  private lastGyroTs = 0;
  private readonly SYNC_TOLERANCE_MS = 20;

  constructor(config: RNSensorConfig = {}) {
    this.config = {
      samplingRateHz:    config.samplingRateHz    ?? 50,
      hrUpdateIntervalMs: config.hrUpdateIntervalMs ?? 1000,
      platform:          config.platform          ?? 'auto',
      hrModule:          config.hrModule          ?? this.detectHRModule(config.platform ?? 'auto'),
    };
  }

  async startSensors(): Promise<void> {
    if (this.active) return;
    const intervalMs = Math.round(1000 / this.config.samplingRateHz);
    setUpdateIntervalForType(SensorTypes.accelerometer, intervalMs);
    setUpdateIntervalForType(SensorTypes.gyroscope, intervalMs);
    this.startAccelerometer();
    this.startGyroscope();
    this.startHeartRate();
    this.active = true;
  }

  async stopSensors(): Promise<void> {
    this.accSubscription?.unsubscribe();
    this.gyroSubscription?.unsubscribe();
    this.hrUnsubscribe?.();
    this.accSubscription  = null;
    this.gyroSubscription = null;
    this.hrUnsubscribe    = null;
    this.active = false;
  }

  isActive(): boolean                        { return this.active; }
  getLastReading(): SensorReading | null     { return this.lastEmittedReading; }

  // ── Sensores ─────────────────────────────────────────────

  private startAccelerometer(): void {
    this.accSubscription = accelerometer
      .pipe(
        filter(d => d !== null),
        map(d => ({ x: d.x / 9.81, y: d.y / 9.81, z: d.z / 9.81, timestamp: d.timestamp }))
      )
      .subscribe({
        next: ({ x, y, z, timestamp }) => {
          this.latestAcc = { x, y, z };
          this.lastAccTs = timestamp;
          this.tryEmitReading();
        },
        error: (err) => console.error('[RNSensorAdapter] Acc:', err),
      });
  }

  private startGyroscope(): void {
    this.gyroSubscription = gyroscope
      .pipe(filter(d => d !== null))
      .subscribe({
        next: ({ x, y, z, timestamp }) => {
          this.latestGyro = { x, y, z };
          this.lastGyroTs = timestamp;
          this.tryEmitReading();
        },
        error: (err) => console.error('[RNSensorAdapter] Gyro:', err),
      });
  }

  private startHeartRate(): void {
    const hrModule = this.config.hrModule;
    if (!hrModule) return;
    try {
      hrModule.startMonitoring(this.config.hrUpdateIntervalMs);
      hrModule.addListener('heartRate', (bpm) => {
        if (bpm > 20 && bpm < 300) this.latestHR = bpm;
      });
      this.hrUnsubscribe = () => { hrModule.removeListener('heartRate'); hrModule.stopMonitoring(); };
    } catch (err) {
      console.warn('[RNSensorAdapter] HR unavailable:', err);
    }
  }

  private tryEmitReading(): void {
    if (Math.abs(this.lastAccTs - this.lastGyroTs) > this.SYNC_TOLERANCE_MS) return;
    const reading: SensorReading = {
      timestamp:     Date.now(),
      accelerometer: { ...this.latestAcc },
      gyroscope:     { ...this.latestGyro },
      heartRate:     this.latestHR,
    };
    this.lastEmittedReading = reading;
    this.onReading?.(reading);
  }

  // ── Detección automática de módulo HR ─────────────────────

  private detectHRModule(platform: string): HRModule | null {
    const os = platform === 'auto' ? Platform.OS : platform;
    if (os === 'android') {
      const native = NativeModules.WearHeartRateModule;
      if (native) return this.wrapAndroidHR(native);
    }
    if (os === 'ios') {
      try {
        const AppleHealthKit = require('react-native-health').default;
        return this.wrapAppleHealthKit(AppleHealthKit);
      } catch { /* not installed */ }
    }
    return null;
  }

  private wrapAndroidHR(native: any): HRModule {
    const emitter   = new NativeEventEmitter(native);
    const listeners = new Map<string, any>();
    return {
      startMonitoring: (ms) => native.startMonitoring(ms),
      stopMonitoring:  ()   => native.stopMonitoring(),
      addListener:  (ev, cb) => { listeners.set(ev, emitter.addListener('HeartRateUpdate', d => cb(d.bpm))); },
      removeListener: (ev)  => { listeners.get(ev)?.remove(); listeners.delete(ev); },
    };
  }

  private wrapAppleHealthKit(kit: any): HRModule {
    let handle: ReturnType<typeof setInterval> | null = null;
    const listeners = new Map<string, (bpm: number) => void>();
    return {
      startMonitoring: (ms) => {
        kit.initHealthKit(
          { permissions: { read: [kit.Constants.Permissions.HeartRate], write: [] } },
          (err: any) => {
            if (err) return;
            handle = setInterval(() => {
              kit.getHeartRateSamples(
                { unit: 'bpm', startDate: new Date(Date.now() - 10_000).toISOString(),
                  endDate: new Date().toISOString(), limit: 1, ascending: false },
                (err: any, results: any[]) => {
                  if (!err && results?.length > 0) listeners.get('heartRate')?.(results[0].value);
                }
              );
            }, ms);
          }
        );
      },
      stopMonitoring: () => { if (handle) clearInterval(handle); },
      addListener:    (ev, cb) => listeners.set(ev, cb),
      removeListener: (ev)     => listeners.delete(ev),
    };
  }
}
