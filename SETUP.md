# SeizureWatch — React Native Adapter
Guía de instalación, configuración e integración.

---

## Estructura del adaptador RN

```
seizure-watch-rn/
├── src/
│   ├── adapters/
│   │   ├── RNSensorAdapter.ts        ← Puente react-native-sensors → motor TS
│   │   └── WearHeartRateModule.kt.ts ← Guía módulo nativo Kotlin (Wear OS)
│   ├── hooks/
│   │   └── useSeizureDetector.ts     ← Hook React principal
│   ├── storage/
│   │   └── RNStorageAdapter.ts       ← AsyncStorage para historial
│   ├── location/
│   │   └── RNLocationProvider.ts     ← GPS para alertas de emergencia
│   ├── screens/
│   │   └── MonitorScreen.tsx         ← Pantalla principal de monitoreo
│   └── components/
│       └── index.tsx                 ← SeizureAlertBanner, SignalBars, EpisodeCard
└── package.json
```

---

## Instalación paso a paso

### 1. Crear proyecto React Native

```bash
npx react-native init SeizureWatchApp --template react-native-template-typescript
cd SeizureWatchApp
```

### 2. Instalar dependencias

```bash
npm install react-native-sensors \
            @react-native-async-storage/async-storage \
            @react-native-community/geolocation \
            react-native-get-random-values \
            react-native-permissions \
            rxjs \
            uuid

# Solo para iOS (HealthKit):
npm install react-native-health

# iOS: instalar pods
cd ios && pod install && cd ..
```

### 3. Copiar el motor SeizureWatch

```bash
# Copiar la carpeta seizure-watch/ al proyecto RN
cp -r ../seizure-watch ./src/seizure-watch
```

### 4. Configurar permisos Android

Editar `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.BODY_SENSORS" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<!-- Para Wear OS -->
<uses-feature android:name="android.hardware.type.watch" />
```

### 5. Configurar permisos iOS

Editar `ios/SeizureWatchApp/Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Para enviar tu ubicación a los cuidadores en caso de emergencia.</string>

<key>NSHealthShareUsageDescription</key>
<string>SeizureWatch necesita leer tu frecuencia cardíaca para detectar crisis.</string>

<key>NSHealthUpdateUsageDescription</key>
<string>SeizureWatch guarda datos de frecuencia cardíaca en HealthKit.</string>
```

### 6. Módulo nativo Wear OS (HR)

Si el target es Wear OS, crear el archivo Kotlin:

```
android/app/src/main/java/com/seizurewatchapp/WearHeartRateModule.kt
```

Copiar el código del archivo `WearHeartRateModule.kt.ts` (sin los comentarios `/* */`).

Luego registrar en `MainApplication.kt`:

```kotlin
override fun getPackages(): List<ReactPackage> = listOf(
  MainReactPackage(),
  WearHeartRatePackage()   // ← agregar esta línea
)
```

---

## Uso en la app

```tsx
// App.tsx
import React from 'react';
import { MonitorScreen } from './src/screens/MonitorScreen';
import { PatientProfile, DEFAULT_SENSITIVITY } from './src/seizure-watch/src/models/types';

const PROFILE: PatientProfile = {
  id: 'pac-001',
  name: 'Nombre del Menor',
  dateOfBirth: '2012-04-15',
  weightKg: 40,
  baselineHeartRate: 78,
  baselineHeartRateMax: 100,
  caregivers: [
    {
      id: 'cg-001',
      name: 'Padre',
      relationship: 'Padre',
      phone: '+56912345678',
      priority: 1,
      notifyViaSMS: true,
      notifyViaPush: true,
    }
  ],
  sensitivityProfile: {
    ...DEFAULT_SENSITIVITY,
    falsePositiveSuppressionLevel: 'medium',
  },
};

const ALERT_CONFIG = {
  pushEnabled: true,
  smsEnabled: true,
  emailEnabled: false,
  pushApiUrl: 'https://tu-backend.com/api/push',
  smsApiUrl: 'https://tu-backend.com/api/sms',
  escalationDelayMs: 60_000,
  maxRetries: 3,
};

export default function App() {
  return <MonitorScreen profile={PROFILE} alertConfig={ALERT_CONFIG} />;
}
```

---

## Frecuencia cardíaca — qué esperar por plataforma

| Plataforma | Fuente HR | Latencia | Notas |
|-----------|-----------|----------|-------|
| Wear OS (Galaxy Watch, Pixel Watch) | `Sensor.TYPE_HEART_RATE` | ~1-3s | Módulo nativo incluido |
| Apple Watch (watchOS + iOS companion) | HealthKit | ~3-10s | Requiere react-native-health |
| Android phone (sin reloj) | Solo acelerómetro | — | HR = null, motor funciona igual |
| iPhone (sin Apple Watch) | Solo acelerómetro | — | HR = null, motor funciona igual |

---

## Consumo de batería estimado

| Modo | Frecuencia | Consumo estimado |
|------|-----------|-----------------|
| Monitoreo activo | 50 Hz | ~15-20% por hora (reloj) |
| Modo económico (sugerido) | 10 Hz en reposo, 50 Hz al detectar movimiento | ~5-8% por hora |
| Solo HR (noche) | HR cada 5s | ~2-3% por hora |

> Para implementar el modo económico, agregar lógica en `RNSensorAdapter` que reduzca `setUpdateIntervalForType` cuando `currentMotionScore < 0.1` por más de 60 segundos.

---

## Próximo paso sugerido: Backend para alertas

Con el adaptador listo, el siguiente paso es el servidor que recibe las alertas:

```
/api/push   → Firebase Cloud Messaging (FCM)
/api/sms    → Twilio (funciona bien en Chile)
/api/email  → SendGrid o Resend
```

Se puede construir en Node.js/Express en ~2-3 horas con las 3 integraciones.
