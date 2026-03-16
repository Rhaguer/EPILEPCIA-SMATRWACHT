// ============================================================
// useSeizureDetector.ts
// Hook React que integra el motor SeizureWatch en cualquier
// componente React Native.
//
// Uso:
//   const { state, activeEvent, stats, start, stop } = useSeizureDetector(profile, alertConfig);
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { SeizureWatch, SeizureWatchConfig }   from '../seizure-watch/src/index';
import { RNSensorAdapter, RNSensorConfig }     from '../adapters/RNSensorAdapter';
import { RNStorageAdapter }                    from '../storage/RNStorageAdapter';
import { RNLocationProvider }                  from '../location/RNLocationProvider';

import type {
  PatientProfile,
  SeizureEvent,
  AlertServiceConfig,
  EpisodeStats,
} from '../seizure-watch/src/models/types';
import type { DetectorState } from '../seizure-watch/src/core/SeizureDetector';

// ─── Tipos del hook ─────────────────────────────────────────

export interface SeizureDetectorState {
  // Estado del sistema
  detectorState: DetectorState;
  isRunning: boolean;
  isInitializing: boolean;
  error: string | null;

  // Evento activo
  activeEvent: SeizureEvent | null;
  suspectedSince: number | null;
  confirmedSince: number | null;

  // Señales en tiempo real
  currentHR: number | null;
  currentConfidence: number;
  currentMotionScore: number;
  currentFrequencyHz: number;

  // Historial
  recentEpisodes: SeizureEvent[];
  stats: EpisodeStats | null;

  // Acciones
  start: () => Promise<void>;
  stop: () => Promise<void>;
  acknowledgeAlert: (eventId: string, caregiverId: string) => void;
  refreshStats: () => void;
}

export interface UseSeizureDetectorOptions {
  profile: PatientProfile;
  alertConfig: AlertServiceConfig;
  sensorConfig?: RNSensorConfig;
  autoStart?: boolean;         // default true
  pauseOnBackground?: boolean; // default false (seguir monitoreando en background)
}

// ─── Hook ───────────────────────────────────────────────────

export function useSeizureDetector(
  options: UseSeizureDetectorOptions
): SeizureDetectorState {
  const { profile, alertConfig, sensorConfig, autoStart = true, pauseOnBackground = false } = options;

  // Refs (no causan re-render)
  const systemRef = useRef<SeizureWatch | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');

  // Estado reactivo
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectorState, setDetectorState] = useState<DetectorState>('IDLE');
  const [activeEvent, setActiveEvent] = useState<SeizureEvent | null>(null);
  const [suspectedSince, setSuspectedSince] = useState<number | null>(null);
  const [confirmedSince, setConfirmedSince] = useState<number | null>(null);
  const [currentHR, setCurrentHR] = useState<number | null>(null);
  const [currentConfidence, setCurrentConfidence] = useState(0);
  const [currentMotionScore, setCurrentMotionScore] = useState(0);
  const [currentFrequencyHz, setCurrentFrequencyHz] = useState(0);
  const [recentEpisodes, setRecentEpisodes] = useState<SeizureEvent[]>([]);
  const [stats, setStats] = useState<EpisodeStats | null>(null);

  // ─── Inicialización ────────────────────────────────────

  useEffect(() => {
    initializeSystem();
    return () => { systemRef.current?.stop(); };
  }, [profile.id]); // Re-inicializa si cambia el paciente

  // ─── AppState (background/foreground) ─────────────────

  useEffect(() => {
    if (!pauseOnBackground) return;

    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current === 'active' && nextState !== 'active') {
        systemRef.current?.stop();
        setIsRunning(false);
      } else if (appStateRef.current !== 'active' && nextState === 'active') {
        start();
      }
      appStateRef.current = nextState;
    });

    return () => sub.remove();
  }, [pauseOnBackground]);

  // ─── Helpers ───────────────────────────────────────────

  const initializeSystem = async () => {
    setIsInitializing(true);
    setError(null);

    try {
      // Detener sistema previo si existe
      await systemRef.current?.stop();

      const sensor   = new RNSensorAdapter(sensorConfig);
      const storage  = new RNStorageAdapter();
      const location = new RNLocationProvider();

      const config: SeizureWatchConfig = {
        profile,
        alertConfig,
        sensorAdapter: sensor,
        storageAdapter: storage,
        samplingRateHz: sensorConfig?.samplingRateHz ?? 50,

        getLocation: () => location.getCurrentLocation(),

        onStatusChange: (status) => {
          setDetectorState(status.state);
          setActiveEvent(status.activeEvent);
          setSuspectedSince(status.suspectedSince);
          setConfirmedSince(status.confirmedSince);

          if (status.lastResult) {
            setCurrentConfidence(status.lastResult.confidence);
            setCurrentMotionScore(status.lastResult.motionScore);
            setCurrentFrequencyHz(status.lastResult.frequencyHz);
          }

          // Actualizar HR desde el último reading del sensor
          const lastReading = sensor.getLastReading();
          if (lastReading?.heartRate) {
            setCurrentHR(lastReading.heartRate);
          }
        },

        onSeizureDetected: (event) => {
          setActiveEvent(event);
          // Agrega al historial reciente inmediatamente
          setRecentEpisodes(prev => [event, ...prev].slice(0, 50));
        },

        onSeizureEnded: (event) => {
          setActiveEvent(null);
          // Actualiza el evento en el historial con duración final
          setRecentEpisodes(prev =>
            prev.map(e => e.id === event.id ? event : e)
          );
          refreshStats();
        },
      };

      const system = new SeizureWatch(config);
      systemRef.current = system;

      if (autoStart) {
        await system.start();
        setIsRunning(true);

        // Cargar historial inicial
        const episodes = system.getEpisodeHistory();
        setRecentEpisodes(episodes.slice(0, 50));
        setStats(system.getStats());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al inicializar sensores';
      setError(msg);
      console.error('[useSeizureDetector] Init error:', err);
    } finally {
      setIsInitializing(false);
    }
  };

  const start = useCallback(async () => {
    if (!systemRef.current || isRunning) return;
    try {
      await systemRef.current.start();
      setIsRunning(true);
      setError(null);
    } catch (err) {
      setError('Error al iniciar sensores');
    }
  }, [isRunning]);

  const stop = useCallback(async () => {
    if (!systemRef.current || !isRunning) return;
    await systemRef.current.stop();
    setIsRunning(false);
    setDetectorState('IDLE');
    setActiveEvent(null);
  }, [isRunning]);

  const acknowledgeAlert = useCallback((eventId: string, caregiverId: string) => {
    systemRef.current?.acknowledgeAlert(eventId, caregiverId);
  }, []);

  const refreshStats = useCallback(() => {
    if (systemRef.current) {
      setStats(systemRef.current.getStats());
    }
  }, []);

  return {
    detectorState,
    isRunning,
    isInitializing,
    error,
    activeEvent,
    suspectedSince,
    confirmedSince,
    currentHR,
    currentConfidence,
    currentMotionScore,
    currentFrequencyHz,
    recentEpisodes,
    stats,
    start,
    stop,
    acknowledgeAlert,
    refreshStats,
  };
}
