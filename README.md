# SeizureWatch 🏥⌚
Sistema de detección de crisis epilépticas para smartwatches — Pacientes < 18 años

---

## ⚠️ AVISO MÉDICO IMPORTANTE

Este sistema es una **herramienta de apoyo**, no un dispositivo médico certificado.
- NO reemplaza supervisión médica ni diagnóstico profesional.
- Los datos deben ser revisados por un **neurólogo pediátrico**.
- Las crisis de ausencia, espasmos infantiles y crisis focales sin componente motor **no son detectables** de forma confiable con solo acelerómetro y FC.
- Para uso clínico real se requiere certificación FDA/CE/ISP y validación clínica.

---

## Tipos de crisis detectables

| Tipo | Señal primaria | Detectabilidad |
|------|---------------|----------------|
| Tónico-clónica (gran mal) | Acelerómetro + FC | ⭐⭐⭐⭐⭐ Alta |
| Mioclónica | Acelerómetro (picos) | ⭐⭐⭐⭐ Buena |
| Tónica | Acelerómetro (rigidez) | ⭐⭐⭐ Moderada |
| Focal motora unilateral | Acelerómetro (asimetría) | ⭐⭐⭐ Moderada |
| Focal no motora / Ausencia | FC (taquicardia sutil) | ⭐ Baja |
| Espasmos infantiles | No detectable confiablemente | ❌ |

---

## Arquitectura

```
seizure-watch/
├── src/
│   ├── models/
│   │   └── types.ts              # Tipos e interfaces base
│   ├── core/
│   │   ├── MotionAnalyzer.ts     # Análisis señal acelerómetro/giroscopio
│   │   ├── HeartRateMonitor.ts   # Análisis frecuencia cardíaca
│   │   └── SeizureDetector.ts    # Motor de fusión + máquina de estados
│   ├── services/
│   │   ├── AlertService.ts       # Alertas push/SMS/email a cuidadores
│   │   └── EpisodeLogger.ts      # Historial y reportes médicos
│   ├── adapters/
│   │   └── SensorAdapter.ts      # Adaptadores por plataforma
│   └── index.ts                  # API pública unificada
└── example.ts                    # Ejemplo de uso completo
```

---

## Flujo de detección

```
Sensor (50 Hz)
     │
     ▼
MotionAnalyzer          HeartRateMonitor
• SMA (Signal Mag. Area)   • Delta vs baseline
• Autocorrelación (freq)   • Tendencia (sube/baja)
• Zero-Crossing Rate       • Patrón post-ictal
• Asimetría ejes           • Riesgo SUDEP
     │                          │
     └──────────┬───────────────┘
                ▼
         Fusión de señales
         (pesos: 65% motion + 35% HR)
                │
                ▼
        Máquina de estados
        IDLE → SUSPECTED → CONFIRMED → POSTICTAL → IDLE
        (confirmación: 10s de señal positiva continua)
                │
         ┌──────┴──────┐
         ▼             ▼
    AlertService   EpisodeLogger
    (Push/SMS/     (Historial +
     Email)         Reportes)
```

---

## Integración por plataforma

### Wear OS (Android)
```kotlin
// Registrar sensores en Kotlin
sensorManager.registerListener(
  listener,
  sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER),
  SensorManager.SENSOR_DELAY_FASTEST // ~50Hz
)
// Pasar datos al motor JS via ReactMethod o WebSocket
```

### Apple Watch (watchOS)
```swift
// Iniciar CoreMotion en Swift
motionManager.deviceMotionUpdateInterval = 1.0 / 50.0
motionManager.startDeviceMotionUpdates(to: .main) { motion, _ in
  // Pasar motion.userAcceleration + motion.rotationRate al bridge
}
```

### Uso en Node.js / React Native
```typescript
import { SeizureWatch } from 'seizure-watch';

const sistema = new SeizureWatch({ profile, alertConfig });
await sistema.start();
```

---

## Configuración de sensibilidad

```typescript
// Para Síndrome de Dravet (alta frecuencia, mayor sensibilidad)
sensitivityProfile: {
  motionThresholdG: 1.2,           // Umbral más bajo
  minSeizureDurationMs: 5_000,     // Confirmar más rápido
  falsePositiveSuppressionLevel: 'low',
}

// Para JME (Epilepsia Mioclónica Juvenil)
sensitivityProfile: {
  motionThresholdG: 2.0,           // Solo picos grandes
  minSeizureDurationMs: 3_000,     // Mioclonías son breves
  hrDeltaThresholdBpm: 25,
}
```

---

## Instalación

```bash
npm install
npm run dev     # Ejecutar con sensor simulado
npm run build   # Compilar TypeScript
```

---

## Licencia
MIT — Uso bajo responsabilidad del implementador. Ver aviso médico arriba.
