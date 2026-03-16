// ─────────────────────────────────────────────────────────────
// @seizure-watch/core — algorithms/SimulatedSensorAdapter.ts
// Generador de datos de sensor para desarrollo y pruebas.
// Simula 6 modos: normal, tonic-clonic, myoclonic,
//                 tonic, exercise, sleep.
// ─────────────────────────────────────────────────────────────

import type { SensorReading, Vector3D } from '../models/types';

export type SimulationMode =
  | 'normal'
  | 'tonic-clonic'
  | 'myoclonic'
  | 'tonic'
  | 'exercise'
  | 'sleep';

export class SimulatedSensorAdapter {
  onReading: ((reading: SensorReading) => void) | null = null;

  private handle:       ReturnType<typeof setInterval> | null = null;
  private lastReading:  SensorReading | null = null;
  private mode:         SimulationMode = 'normal';
  private modeStart:    number = Date.now();
  private readonly samplingRateHz: number;

  constructor(samplingRateHz = 50) {
    this.samplingRateHz = samplingRateHz;
  }

  async startSensors(): Promise<void> {
    const intervalMs = Math.round(1000 / this.samplingRateHz);
    this.handle = setInterval(() => {
      const reading  = this.generate();
      this.lastReading = reading;
      this.onReading?.(reading);
    }, intervalMs);
  }

  async stopSensors(): Promise<void> {
    if (this.handle) { clearInterval(this.handle); this.handle = null; }
  }

  setMode(mode: SimulationMode): void {
    this.mode      = mode;
    this.modeStart = Date.now();
  }

  isActive(): boolean                    { return this.handle !== null; }
  getLastReading(): SensorReading | null { return this.lastReading; }

  // ── Generador de señales ─────────────────────────────────

  private generate(): SensorReading {
    const elapsed = (Date.now() - this.modeStart) / 1000;
    let acc: Vector3D, gyro: Vector3D, hr: number;

    switch (this.mode) {
      case 'tonic-clonic': {
        const phase = 2 * Math.PI * 5 * elapsed;
        const amp   = 3.0 + this.noise(0.5);
        acc  = { x: amp * Math.sin(phase) + this.noise(0.3),
                 y: amp * Math.cos(phase * 1.1) + this.noise(0.3),
                 z: amp * 0.4 * Math.sin(phase * 0.9) + this.noise(0.2) };
        gyro = { x: 2.5 * Math.sin(phase + 0.5) + this.noise(0.2),
                 y: 2.0 * Math.cos(phase)        + this.noise(0.2),
                 z: this.noise(0.5) };
        hr   = 110 + elapsed * 0.8 + this.noise(5);
        break;
      }
      case 'myoclonic': {
        const spike = Math.random() < 0.15;
        const peak  = spike ? 5 + Math.random() * 3 : 0.1;
        acc  = { x: peak * (Math.random() - 0.5) * 2 + this.noise(0.1),
                 y: peak * (Math.random() - 0.5) * 2 + this.noise(0.1),
                 z: peak * 0.3 * (Math.random() - 0.5)+ this.noise(0.1) };
        gyro = { x: spike ? (Math.random() - 0.5) * 4 : this.noise(0.1),
                 y: spike ? (Math.random() - 0.5) * 3 : this.noise(0.1),
                 z: this.noise(0.1) };
        hr   = 85 + this.noise(8);
        break;
      }
      case 'tonic': {
        const r = 2.5 + this.noise(0.2);
        acc  = { x: r * 0.6 + this.noise(0.15), y: r * 0.8 + this.noise(0.15), z: r * 0.3 + this.noise(0.1) };
        gyro = { x: this.noise(0.3), y: this.noise(0.3), z: this.noise(0.2) };
        hr   = 95 + elapsed * 0.5 + this.noise(5);
        break;
      }
      case 'exercise': {
        const phase = 2 * Math.PI * 1.5 * elapsed;
        acc  = { x: 1.2 * Math.sin(phase) + this.noise(0.3),
                 y: 1.8 * Math.cos(phase) + this.noise(0.3),
                 z: 0.5 * Math.sin(phase * 0.5) + this.noise(0.2) };
        gyro = { x: 0.8 * Math.sin(phase) + this.noise(0.2),
                 y: 0.6 * Math.cos(phase) + this.noise(0.2), z: this.noise(0.3) };
        hr   = 140 + this.noise(10);
        break;
      }
      case 'sleep': {
        acc  = { x: this.noise(0.05), y: this.noise(0.05), z: 1.0 + this.noise(0.03) };
        gyro = { x: this.noise(0.02), y: this.noise(0.02), z: this.noise(0.02) };
        hr   = 55 + this.noise(5);
        break;
      }
      default: {
        acc  = { x: this.noise(0.1), y: this.noise(0.1), z: 1.0 + this.noise(0.05) };
        gyro = { x: this.noise(0.05), y: this.noise(0.05), z: this.noise(0.05) };
        hr   = 72 + this.noise(6);
      }
    }

    return {
      timestamp:     Date.now(),
      accelerometer: acc,
      gyroscope:     gyro,
      heartRate:     Math.max(30, Math.round(hr)),
    };
  }

  private noise(amplitude: number): number {
    return (Math.random() - 0.5) * 2 * amplitude;
  }
}
