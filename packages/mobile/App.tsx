// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — App.tsx
// Punto de entrada de la app React Native.
// Configura el perfil del paciente y lanza el navegador.
// ─────────────────────────────────────────────────────────────

import 'react-native-get-random-values'; // necesario para uuid
import React from 'react';

import { AppNavigator } from './src/navigation/AppNavigator';
import { DEFAULT_SENSITIVITY } from '@seizure-watch/core';
import type { PatientProfile, AlertServiceConfig } from '@seizure-watch/core';

// ── Configuración del paciente ───────────────────────────────
// En producción esto debería cargarse desde AsyncStorage,
// base de datos segura o sesión autenticada.

const PATIENT_PROFILE: PatientProfile = {
  id: 'pac-001',
  name: 'Nombre del Menor',
  dateOfBirth: '2012-04-15',
  weightKg: 40,
  knownEpilepsyType: 'Epilepsia mioclónica juvenil',
  baselineHeartRate: 78,
  baselineHeartRateMax: 100,

  caregivers: [
    {
      id: 'cg-001',
      name: 'Padre',
      relationship: 'Padre',
      phone: '+56912345678',
      email: 'padre@ejemplo.cl',
      priority: 1,
      notifyViaSMS: true,
      notifyViaPush: true,
    },
    {
      id: 'cg-002',
      name: 'Abuela',
      relationship: 'Abuela',
      phone: '+56987654321',
      email: 'abuela@ejemplo.cl',
      priority: 2,
      notifyViaSMS: true,
      notifyViaPush: false,
    },
  ],

  sensitivityProfile: {
    ...DEFAULT_SENSITIVITY,
    motionThresholdG: 1.5,
    minSeizureDurationMs: 10_000,
    hrDeltaThresholdBpm: 30,
    falsePositiveSuppressionLevel: 'medium',
  },
};

const ALERT_CONFIG: AlertServiceConfig = {
  pushEnabled: true,
  smsEnabled: true,
  emailEnabled: true,

  pushApiUrl: 'https://tu-backend.com/api/push',
  smsApiUrl: 'https://tu-backend.com/api/sms',
  emailApiUrl: 'https://tu-backend.com/api/email',

  escalationDelayMs: 60_000, // 1 minuto antes de escalar al siguiente cuidador
  maxRetries: 3,
};

export default function App() {
  return (
    <AppNavigator
      profile={PATIENT_PROFILE}
      alertConfig={ALERT_CONFIG}
    />
  );
}