# SeizureWatch 🏥⌚
Sistema de detección de crisis epilépticas en menores (<18 años) para smartwatches.

---

## ⚠️ Aviso médico

Este sistema es una **herramienta de apoyo**, no un dispositivo médico certificado.
Los datos deben ser revisados por un **neurólogo pediátrico**.
Para uso clínico real se requiere certificación ISP (Chile) / FDA / CE y validación clínica.

---

## Estructura del monorepo

```
seizure-watch/
│
├── packages/
│   │
│   ├── core/                          ← Motor de detección (agnóstico de plataforma)
│   │   └── src/
│   │       ├── models/
│   │       │   └── types.ts           ← Tipos e interfaces base del sistema
│   │       ├── algorithms/
│   │       │   ├── MotionAnalyzer.ts  ← Procesamiento señal acelerómetro/giroscopio
│   │       │   ├── HeartRateMonitor.ts← Análisis frecuencia cardíaca
│   │       │   └── SimulatedSensorAdapter.ts ← Generador de datos para pruebas
│   │       ├── detector/
│   │       │   └── SeizureDetector.ts ← Motor central + máquina de estados
│   │       ├── services/
│   │       │   ├── AlertService.ts    ← Alertas Push / SMS / Email a cuidadores
│   │       │   └── EpisodeLogger.ts   ← Historial persistente + reportes médicos
│   │       └── index.ts               ← API pública del paquete
│   │
│   └── mobile/                        ← App React Native (Android / iOS / Wear OS)
│       ├── App.tsx                    ← Punto de entrada
│       ├── src/
│       │   ├── adapters/
│       │   │   └── RNSensorAdapter.ts ← Puente react-native-sensors → core
│       │   ├── hooks/
│       │   │   └── useSeizureDetector.ts ← Hook React principal
│       │   ├── screens/
│       │   │   ├── MonitorScreen.tsx  ← Pantalla de monitoreo en tiempo real
│       │   │   └── HistoryScreen.tsx  ← Historial de episodios
│       │   ├── components/
│       │   │   ├── SeizureAlertBanner.tsx ← Banner animado de crisis activa
│       │   │   ├── SignalBars.tsx     ← Barra de señal animada
│       │   │   ├── EpisodeCard.tsx    ← Tarjeta de episodio
│       │   │   └── index.ts           ← Barrel export
│       │   ├── storage/
│       │   │   └── RNStorageAdapter.ts← AsyncStorage para historial
│       │   ├── location/
│       │   │   └── RNLocationProvider.ts ← GPS para alertas de emergencia
│       │   └── navigation/
│       │       └── AppNavigator.tsx   ← React Navigation
│       ├── android/
│       │   └── app/src/main/
│       │       ├── AndroidManifest.xml← Permisos Android / Wear OS
│       │       └── java/com/seizurewatch/
│       │           └── WearHeartRateModule.kt ← Módulo nativo Kotlin (HR)
│       └── ios/
│           └── Info.plist             ← Permisos iOS / HealthKit
│
├── docs/
│   └── ARCHITECTURE.md
├── package.json                       ← Workspace root (npm workspaces)
└── tsconfig.base.json                 ← TypeScript base compartido
```

---

## Flujo de detección

```
Sensor físico (50 Hz)
       │
       ▼
 RNSensorAdapter          ← packages/mobile
  (react-native-sensors
   + módulo Kotlin/Swift)
       │
       ▼
 SeizureDetector          ← packages/core/detector
       │
   ┌───┴───────────────────────┐
   ▼                           ▼
MotionAnalyzer           HeartRateMonitor
 • SMA                    • Delta vs baseline
 • Autocorrelación (freq) • Tendencia HR
 • ZCR                    • Patrón post-ictal
 • Asimetría ejes         • Riesgo SUDEP
   │                           │
   └───────────┬───────────────┘
               ▼
        Fusión de señales
        65% movimiento + 35% FC
               │
               ▼
       Máquina de estados
  IDLE → SUSPECTED → CONFIRMED → POSTICTAL
  (confirmación: 10s señal positiva continua)
               │
          ┌────┴─────┐
          ▼          ▼
    AlertService  EpisodeLogger
   Push/SMS/Email  Historial + Reportes
```

---

## Tipos de crisis detectables

| Tipo                | Señal primaria       | Detectabilidad |
|---------------------|----------------------|----------------|
| Tónico-clónica      | Acc + FC             | ⭐⭐⭐⭐⭐ Alta   |
| Mioclónica          | Acc (picos)          | ⭐⭐⭐⭐ Buena   |
| Tónica              | Acc (rigidez)        | ⭐⭐⭐ Moderada |
| Focal motora        | Acc (asimetría ejes) | ⭐⭐⭐ Moderada |
| Focal no motora     | FC (taquicardia)     | ⭐ Baja         |
| Ausencias           | No confiable         | ❌              |
| Espasmos infantiles | No detectable        | ❌              |

---

## Instalación y arranque

### Prerrequisitos
- Node.js 20+
- React Native CLI
- Android Studio (para Wear OS / Android)
- Xcode 15+ (para iOS / Apple Watch)

### Setup

```bash
# 1. Instalar todas las dependencias del monorepo
npm install

# 2. Compilar el paquete core
npm run build:core

# 3. Instalar pods iOS
cd packages/mobile/ios && pod install && cd ../../..

# 4. Correr en Android
npm run android -w packages/mobile

# 5. Correr en iOS
npm run ios -w packages/mobile
```

### Configurar permisos Android

Editar `packages/mobile/android/app/src/main/AndroidManifest.xml`
(ya incluido con todos los permisos necesarios).

### Registrar módulo nativo Wear OS

En `MainApplication.kt` del proyecto Android:
```kotlin
override fun getPackages() = listOf(
  MainReactPackage(),
  WearHeartRatePackage()   // ← agregar
)
```

---

## Configuración de sensibilidad por tipo de epilepsia

```typescript
// Síndrome de Dravet (alta frecuencia, umbral bajo)
sensitivityProfile: {
  motionThresholdG: 1.2,
  minSeizureDurationMs: 5_000,
  falsePositiveSuppressionLevel: 'low',
}

// JME — Epilepsia Mioclónica Juvenil
sensitivityProfile: {
  motionThresholdG: 2.0,
  minSeizureDurationMs: 3_000,
  hrDeltaThresholdBpm: 25,
}

// Lennox-Gastaut (crisis variadas, más falsos positivos)
sensitivityProfile: {
  motionThresholdG: 1.8,
  falsePositiveSuppressionLevel: 'high',
  postictalDetectionEnabled: true,
}
```

---

## Backend requerido (no incluido)

El `AlertService` llama a estos 3 endpoints que debes implementar:

| Endpoint          | Tecnología sugerida       |
|-------------------|--------------------------|
| `POST /api/push`  | Firebase Cloud Messaging  |
| `POST /api/sms`   | Twilio (funciona en Chile)|
| `POST /api/email` | SendGrid / Resend         |

---

## Próximos pasos sugeridos

1. **Backend de alertas** — Node.js + Firebase + Twilio (~4h)
2. **Calibración** — Registrar sesiones reales, ajustar umbrales por paciente
3. **Modo bajo consumo** — Reducir a 10 Hz en reposo, subir a 50 Hz al detectar movimiento
4. **ML** — Reemplazar umbrales manuales por TensorFlow Lite (~90% sensibilidad en TC)
5. **Validación clínica** — Coordinación con neurólogo pediátrico

---

## Licencia
MIT — Uso bajo responsabilidad del implementador.
Ver aviso médico al inicio de este documento.
