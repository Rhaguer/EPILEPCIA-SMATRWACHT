// ============================================================
// EJEMPLO DE USO — SeizureWatch
// Muestra cómo inicializar y usar el sistema completo.
// ============================================================

import {
  SeizureWatch,
  PatientProfile,
  DEFAULT_SENSITIVITY,
  SimulatedSensorAdapter,
} from './src/index';

// ─── 1. Definir perfil del paciente ─────────────────────────

const paciente: PatientProfile = {
  id: 'pac-001',
  name: 'Nombre del Menor',
  dateOfBirth: '2012-04-15',       // 12 años
  weightKg: 40,
  knownEpilepsyType: 'Epilepsia mioclónica juvenil',
  baselineHeartRate: 78,
  baselineHeartRateMax: 95,

  caregivers: [
    {
      id: 'cg-001',
      name: 'Padre / Madre',
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
      priority: 2,
      notifyViaSMS: true,
      notifyViaPush: false,
    },
  ],

  sensitivityProfile: {
    ...DEFAULT_SENSITIVITY,
    motionThresholdG: 1.5,
    minTremorFreqHz: 3,
    maxTremorFreqHz: 20,
    minSeizureDurationMs: 10_000,    // 10 segundos para confirmar
    hrDeltaThresholdBpm: 30,
    falsePositiveSuppressionLevel: 'medium',
    postictalDetectionEnabled: true,
  },
};

// ─── 2. Crear el sistema ─────────────────────────────────────

const sensor = new SimulatedSensorAdapter(50); // 50 Hz

const sistema = new SeizureWatch({
  profile: paciente,

  alertConfig: {
    pushEnabled: true,
    smsEnabled: true,
    emailEnabled: true,
    pushApiUrl:  'https://tu-servidor.com/api/push',
    smsApiUrl:   'https://tu-servidor.com/api/sms',
    emailApiUrl: 'https://tu-servidor.com/api/email',
    escalationDelayMs: 60_000,  // escalar si no hay acuse en 1 minuto
    maxRetries: 3,
  },

  sensorAdapter: sensor,
  samplingRateHz: 50,

  getLocation: async () => {
    // Implementar con Geolocation API del dispositivo
    return { lat: -33.4569, lon: -70.6483 }; // Ejemplo Santiago
  },

  onStatusChange: (status) => {
    console.log(`[Estado] ${status.state}`, {
      confianza: status.lastResult?.confidence?.toFixed(2),
      tipo: status.lastResult?.type,
    });
  },

  onSeizureDetected: (event) => {
    // Aquí puedes actualizar la UI del smartwatch
    console.log('CRISIS ACTIVA:', event);
    // Ejemplo: vibrar el reloj, mostrar pantalla de alerta, etc.
  },

  onSeizureEnded: (event) => {
    console.log('CRISIS TERMINADA:', {
      duracion: `${Math.round((event.durationMs ?? 0) / 1000)}s`,
      tipo: event.type,
    });
  },
});

// ─── 3. Iniciar el sistema ───────────────────────────────────

async function main() {
  await sistema.start();
  console.log('✅ SeizureWatch activo.');

  // ─── Demostración: simular diferentes estados ──────────────

  // Los primeros 15s → modo normal
  setTimeout(() => {
    console.log('\n>> SIMULANDO: Actividad normal por 15s...');
    sensor.setMode('normal');
  }, 0);

  // A los 15s → simular crisis tónico-clónica
  setTimeout(() => {
    console.log('\n>> SIMULANDO: Crisis tónico-clónica...');
    sensor.setMode('tonic-clonic');
  }, 15_000);

  // A los 50s → volver a normal (crisis termina)
  setTimeout(() => {
    console.log('\n>> SIMULANDO: Fin de crisis, período post-ictal...');
    sensor.setMode('normal');
  }, 50_000);

  // A los 90s → mostrar estadísticas
  setTimeout(async () => {
    const stats = sistema.getStats();
    console.log('\n📊 ESTADÍSTICAS:');
    console.log('  Total episodios:', stats.totalEpisodes);
    console.log('  Último en:', stats.lastEpisodeAt
      ? new Date(stats.lastEpisodeAt).toLocaleString('es-CL')
      : 'N/A'
    );

    const report = sistema.generateReport(30);
    console.log('\n📋 REPORTE MÉDICO (últimos 30 días):');
    console.log(report.notes);

    await sistema.stop();
  }, 90_000);
}

main().catch(console.error);
