// ============================================================
// SENSOR ADAPTERS
// Capa de abstracción entre la plataforma del smartwatch
// y el motor de detección. Implementa un adaptador por
// plataforma; el detector no sabe de dónde vienen los datos.
//
// Incluye:
//  • SensorAdapter (interfaz base)
//  • WearOSSensorAdapter (Wear OS / Android - pseudocódigo Kotlin-style)
//  • WatchOSSensorAdapter (Apple Watch - pseudocódigo Swift-style)
//  • SimulatedSensorAdapter (pruebas y desarrollo)
// ============================================================

import { SensorReading, Vector3D } from '../models/types';

// ─── Interfaz base ──────────────────────────────────────────

export interface SensorAdapter {
  startSensors(): Promise<void>;
  stopSensors(): Promise<void>;
  onReading: ((reading: SensorReading) => void) | null;
  getLastReading(): SensorReading | null;
  isActive(): boolean;
}

// ─── Adaptador simulado (desarrollo / pruebas) ──────────────

export type SimulationMode =
  | 'normal'
  | 'tonic-clonic'
  | 'exercise'
  | 'sleep'
  | 'myoclonic'
  | 'tonic';

export class SimulatedSensorAdapter implements SensorAdapter {
  onReading: ((reading: SensorReading) => void) | null = null;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastReading: SensorReading | null = null;
  private mode: SimulationMode = 'normal';
  private modeStartTime = Date.now();
  private samplingRateHz: number;

  constructor(samplingRateHz = 50) {
    this.samplingRateHz = samplingRateHz;
  }

  async startSensors(): Promise<void> {
    const intervalMs = Math.round(1000 / this.samplingRateHz);
    this.intervalHandle = setInterval(() => {
      const reading = this.generateReading();
      this.lastReading = reading;
      this.onReading?.(reading);
    }, intervalMs);
    console.log(`[SimulatedSensor] Started at ${this.samplingRateHz}Hz in mode: ${this.mode}`);
  }

  async stopSensors(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  setMode(mode: SimulationMode): void {
    this.mode = mode;
    this.modeStartTime = Date.now();
    console.log(`[SimulatedSensor] Mode changed to: ${mode}`);
  }

  isActive(): boolean { return this.intervalHandle !== null; }
  getLastReading(): SensorReading | null { return this.lastReading; }

  private generateReading(): SensorReading {
    const t = Date.now();
    const elapsed = (t - this.modeStartTime) / 1000; // segundos desde cambio de modo

    let acc: Vector3D;
    let gyro: Vector3D;
    let hr: number;

    switch (this.mode) {
      case 'tonic-clonic': {
        // Sacudidas rítmicas ~4-6 Hz, alta amplitud
        const freq = 5; // Hz
        const amp = 3.0 + Math.random() * 0.5;
        const phase = (2 * Math.PI * freq * elapsed);
        acc = {
          x: amp * Math.sin(phase) + this.noise(0.3),
          y: amp * Math.cos(phase * 1.1) + this.noise(0.3),
          z: amp * 0.4 * Math.sin(phase * 0.9) + this.noise(0.2),
        };
        gyro = {
          x: 2.5 * Math.sin(phase + 0.5) + this.noise(0.2),
          y: 2.0 * Math.cos(phase) + this.noise(0.2),
          z: this.noise(0.5),
        };
        hr = 110 + elapsed * 0.8 + this.noise(5); // taquicardia progresiva
        break;
      }

      case 'myoclonic': {
        // Sacudidas breves y fuertes, irregulares
        const isSake = Math.random() < 0.15; // 15% de muestras tienen pico
        const peak = isSake ? 5 + Math.random() * 3 : 0.1;
        acc = {
          x: peak * (Math.random() - 0.5) * 2 + this.noise(0.1),
          y: peak * (Math.random() - 0.5) * 2 + this.noise(0.1),
          z: peak * 0.3 * (Math.random() - 0.5) + this.noise(0.1),
        };
        gyro = {
          x: isSake ? (Math.random() - 0.5) * 4 : this.noise(0.1),
          y: isSake ? (Math.random() - 0.5) * 3 : this.noise(0.1),
          z: this.noise(0.1),
        };
        hr = 85 + this.noise(8);
        break;
      }

      case 'tonic': {
        // Rigidez: alta magnitud, sin oscilación rítmica
        const rigidity = 2.5 + this.noise(0.2);
        acc = {
          x: rigidity * 0.6 + this.noise(0.15),
          y: rigidity * 0.8 + this.noise(0.15),
          z: rigidity * 0.3 + this.noise(0.1),
        };
        gyro = { x: this.noise(0.3), y: this.noise(0.3), z: this.noise(0.2) };
        hr = 95 + elapsed * 0.5 + this.noise(5);
        break;
      }

      case 'exercise': {
        // Ejercicio: movimiento rítmico pero < 3 Hz, taquicardia moderada
        const freq = 1.5;
        const phase = 2 * Math.PI * freq * elapsed;
        acc = {
          x: 1.2 * Math.sin(phase) + this.noise(0.3),
          y: 1.8 * Math.cos(phase) + this.noise(0.3),
          z: 0.5 * Math.sin(phase * 0.5) + this.noise(0.2),
        };
        gyro = {
          x: 0.8 * Math.sin(phase) + this.noise(0.2),
          y: 0.6 * Math.cos(phase) + this.noise(0.2),
          z: this.noise(0.3),
        };
        hr = 140 + this.noise(10);
        break;
      }

      case 'sleep': {
        // Sueño: mínimo movimiento, HR baja
        acc = {
          x: this.noise(0.05),
          y: this.noise(0.05),
          z: 1.0 + this.noise(0.03), // gravedad en eje Z
        };
        gyro = { x: this.noise(0.02), y: this.noise(0.02), z: this.noise(0.02) };
        hr = 55 + this.noise(5);
        break;
      }

      default: { // 'normal'
        acc = {
          x: this.noise(0.1),
          y: this.noise(0.1),
          z: 1.0 + this.noise(0.05),
        };
        gyro = { x: this.noise(0.05), y: this.noise(0.05), z: this.noise(0.05) };
        hr = 72 + this.noise(6);
        break;
      }
    }

    return {
      timestamp: t,
      accelerometer: acc,
      gyroscope: gyro,
      heartRate: Math.max(30, Math.round(hr)),
    };
  }

  private noise(amplitude: number): number {
    return (Math.random() - 0.5) * 2 * amplitude;
  }
}

// ─── Wear OS (Android) — Pseudocódigo/Guía de implementación ──
//
// En Kotlin real, el código nativo sería así:
//
// class WearOSSensorBridge(
//   private val sensorManager: SensorManager
// ) {
//   private val accSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
//   private val gyroSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
//   private val hrSensor   = sensorManager.getDefaultSensor(Sensor.TYPE_HEART_RATE)
//
//   fun startListening(listener: SensorEventListener) {
//     sensorManager.registerListener(listener, accSensor,  SensorManager.SENSOR_DELAY_FASTEST)
//     sensorManager.registerListener(listener, gyroSensor, SensorManager.SENSOR_DELAY_FASTEST)
//     sensorManager.registerListener(listener, hrSensor,   SensorManager.SENSOR_DELAY_NORMAL)
//   }
//
//   override fun onSensorChanged(event: SensorEvent) {
//     when (event.sensor.type) {
//       Sensor.TYPE_ACCELEROMETER -> {
//         acc = Vector3D(event.values[0], event.values[1], event.values[2])
//         accTs = event.timestamp
//       }
//       Sensor.TYPE_HEART_RATE -> {
//         hr = event.values[0].toInt()
//       }
//     }
//     // Al tener nueva muestra completa, llamar al motor de JS
//     // mediante ReactMethod/JSI bridge o WebSocket
//     bridgeToJS(acc, gyro, hr, System.currentTimeMillis())
//   }
// }

// ─── watchOS (Apple Watch) — Pseudocódigo/Guía de implementación ──
//
// En Swift real:
//
// import CoreMotion, HealthKit
//
// class WatchSensorManager: NSObject {
//   let motionManager = CMMotionManager()
//   let healthStore   = HKHealthStore()
//
//   func startAccelerometer() {
//     motionManager.deviceMotionUpdateInterval = 1.0 / 50.0 // 50 Hz
//     motionManager.startDeviceMotionUpdates(to: .main) { motion, error in
//       guard let m = motion else { return }
//       let acc  = Vector3D(m.userAcceleration.x, m.userAcceleration.y, m.userAcceleration.z)
//       let gyro = Vector3D(m.rotationRate.x, m.rotationRate.y, m.rotationRate.z)
//       self.forwardToDetector(acc: acc, gyro: gyro)
//     }
//   }
//
//   func startHeartRate() {
//     let hrType = HKObjectType.quantityType(forIdentifier: .heartRate)!
//     let query  = HKAnchoredObjectQuery(type: hrType, ...) { _, samples, _, _, _ in
//       guard let samples = samples as? [HKQuantitySample] else { return }
//       let bpm = samples.last?.quantity.doubleValue(for: .init(from: "count/min"))
//       self.forwardHR(bpm: Int(bpm ?? 0))
//     }
//     healthStore.execute(query)
//   }
// }

// ─── Exportar tipo utilitario para integración JS ───────────

export interface SensorBridgeMessage {
  type: 'sensor_reading';
  payload: SensorReading;
}

// Wrapper para integración via WebSocket (React Native / Capacitor)
export function parseBridgeMessage(raw: string): SensorReading | null {
  try {
    const msg: SensorBridgeMessage = JSON.parse(raw);
    if (msg.type === 'sensor_reading' && msg.payload) {
      return msg.payload;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeBridgeMessage(reading: SensorReading): string {
  return JSON.stringify({ type: 'sensor_reading', payload: reading });
}
