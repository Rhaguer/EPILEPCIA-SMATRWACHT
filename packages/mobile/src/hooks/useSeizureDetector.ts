// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — hooks/useSeizureDetector.ts
// Hook React que integra @seizure-watch/core en la app RN.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus }                 from 'react-native';

import {
  SeizureDetector,
  EpisodeLogger,
  AlertService,
  SeizureEvent,
  PatientProfile,
  AlertServiceConfig,
  EpisodeStats,
  DEFAULT_SENSITIVITY,
  SeizurePhase,
} from '@seizure-watch/core';
import type { DetectorState, DetectorStatus } from '@seizure-watch/core';

import { RNSensorAdapter, RNSensorConfig } from '@adapters/RNSensorAdapter';
import { RNStorageAdapter }                from '@storage/RNStorageAdapter';
import { RNLocationProvider }              from '@location/RNLocationProvider';

export interface UseSeizureDetectorOptions {
  profile:        PatientProfile;
  alertConfig:    AlertServiceConfig;
  sensorConfig?:  RNSensorConfig;
  autoStart?:     boolean;
  pauseOnBackground?: boolean;
}

export interface SeizureDetectorHookResult {
  detectorState:      DetectorState;
  isRunning:          boolean;
  isInitializing:     boolean;
  error:              string | null;
  activeEvent:        SeizureEvent | null;
  suspectedSince:     number | null;
  confirmedSince:     number | null;
  currentHR:          number | null;
  currentConfidence:  number;
  currentMotionScore: number;
  currentFrequencyHz: number;
  recentEpisodes:     SeizureEvent[];
  stats:              EpisodeStats | null;
  start:              () => Promise<void>;
  stop:               () => Promise<void>;
  acknowledgeAlert:   (eventId: string, caregiverId: string) => void;
  refreshStats:       () => void;
}

export function useSeizureDetector(
  options: UseSeizureDetectorOptions
): SeizureDetectorHookResult {
  const { profile, alertConfig, sensorConfig, autoStart = true, pauseOnBackground = false } = options;

  // Refs — no provocan re-render
  const detectorRef  = useRef<SeizureDetector | null>(null);
  const loggerRef    = useRef<EpisodeLogger | null>(null);
  const alertsRef    = useRef<AlertService | null>(null);
  const sensorRef    = useRef<RNSensorAdapter | null>(null);
  const locationRef  = useRef<RNLocationProvider | null>(null);
  const appStateRef  = useRef<AppStateStatus>('active');

  // Estado reactivo
  const [isRunning,          setIsRunning]          = useState(false);
  const [isInitializing,     setIsInitializing]     = useState(false);
  const [error,              setError]              = useState<string | null>(null);
  const [detectorState,      setDetectorState]      = useState<DetectorState>('IDLE');
  const [activeEvent,        setActiveEvent]        = useState<SeizureEvent | null>(null);
  const [suspectedSince,     setSuspectedSince]     = useState<number | null>(null);
  const [confirmedSince,     setConfirmedSince]     = useState<number | null>(null);
  const [currentHR,          setCurrentHR]          = useState<number | null>(null);
  const [currentConfidence,  setCurrentConfidence]  = useState(0);
  const [currentMotionScore, setCurrentMotionScore] = useState(0);
  const [currentFrequencyHz, setCurrentFrequencyHz] = useState(0);
  const [recentEpisodes,     setRecentEpisodes]     = useState<SeizureEvent[]>([]);
  const [stats,              setStats]              = useState<EpisodeStats | null>(null);

  // ── Inicialización ────────────────────────────────────────

  useEffect(() => {
    initSystem();
    return () => { teardown(); };
  }, [profile.id]);

  // ── Manejo background/foreground ──────────────────────────

  useEffect(() => {
    if (!pauseOnBackground) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (appStateRef.current === 'active' && next !== 'active') teardown();
      else if (appStateRef.current !== 'active' && next === 'active') initSystem();
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [pauseOnBackground]);

  // ── Core ─────────────────────────────────────────────────

  const initSystem = async () => {
    setIsInitializing(true);
    setError(null);
    try {
      await teardown();

      const sensor   = new RNSensorAdapter(sensorConfig);
      const storage  = new RNStorageAdapter();
      const location = new RNLocationProvider();

      sensorRef.current   = sensor;
      locationRef.current = location;

      const logger = new EpisodeLogger(profile.id, storage);
      await logger.initialize();
      loggerRef.current = logger;

      const alerts = new AlertService(alertConfig, () => location.getCurrentLocation());
      alertsRef.current = alerts;

      const detector = new SeizureDetector(
        profile,
        // onSeizureDetected
        async (event) => {
          setActiveEvent(event);
          setRecentEpisodes(prev => [event, ...prev].slice(0, 50));
          event.alertSent      = true;
          event.alertTimestamp = Date.now();
          await alerts.sendSeizureAlert(event, profile);
          await logger.logEpisode(event);
        },
        // onSeizureEnded
        async (event) => {
          setActiveEvent(null);
          setRecentEpisodes(prev => prev.map(e => e.id === event.id ? event : e));
          await logger.updateEpisode(event.id, { endTime: event.endTime, durationMs: event.durationMs });
          await alerts.sendSeizureEndedAlert(event, profile);
          setStats(logger.computeStats());
        },
        // onStatusChange
        (status: DetectorStatus) => {
          setDetectorState(status.state);
          setActiveEvent(status.activeEvent);
          setSuspectedSince(status.suspectedSince);
          setConfirmedSince(status.confirmedSince);
          if (status.lastResult) {
            setCurrentConfidence(status.lastResult.confidence);
            setCurrentMotionScore(status.lastResult.motionScore);
            setCurrentFrequencyHz(status.lastResult.frequencyHz);
          }
          const last = sensor.getLastReading();
          if (last?.heartRate) setCurrentHR(last.heartRate);
        },
        // onSudepRisk
        async (event) => {
          console.warn('[SeizureDetector] SUDEP risk detected');
          await alerts.sendSudepRiskAlert(event, profile);
        }
      );

      detectorRef.current = detector;
      sensor.onReading    = (r) => detector.processSample(r);

      if (autoStart) {
        await sensor.startSensors();
        await location.startTracking();
        setIsRunning(true);
        setRecentEpisodes(logger.getAllEpisodes().slice(0, 50));
        setStats(logger.computeStats());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al inicializar sensores');
    } finally {
      setIsInitializing(false);
    }
  };

  const teardown = async () => {
    await sensorRef.current?.stopSensors();
    locationRef.current?.stopTracking();
    setIsRunning(false);
  };

  const start = useCallback(async () => {
    if (isRunning) return;
    try {
      await sensorRef.current?.startSensors();
      await locationRef.current?.startTracking();
      setIsRunning(true);
      setError(null);
    } catch {
      setError('Error al iniciar sensores');
    }
  }, [isRunning]);

  const stop = useCallback(async () => {
    await teardown();
    setDetectorState('IDLE');
    setActiveEvent(null);
  }, []);

  const acknowledgeAlert = useCallback((eventId: string, caregiverId: string) => {
    alertsRef.current?.acknowledgeAlert(eventId, caregiverId);
  }, []);

  const refreshStats = useCallback(() => {
    if (loggerRef.current) setStats(loggerRef.current.computeStats());
  }, []);

  return {
    detectorState, isRunning, isInitializing, error,
    activeEvent, suspectedSince, confirmedSince,
    currentHR, currentConfidence, currentMotionScore, currentFrequencyHz,
    recentEpisodes, stats,
    start, stop, acknowledgeAlert, refreshStats,
  };
}
