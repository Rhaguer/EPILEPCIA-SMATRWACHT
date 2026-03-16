// ============================================================
// MonitorScreen.tsx
// Pantalla principal de la app companion en el smartphone.
// Muestra el estado del detector en tiempo real,
// historial de episodios y acceso a ajustes.
// ============================================================

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Vibration,
  Alert,
} from 'react-native';

import { useSeizureDetector } from '../hooks/useSeizureDetector';
import { SeizureAlertBanner } from '../components/SeizureAlertBanner';
import { SignalBars } from '../components/SignalBars';
import { EpisodeCard } from '../components/EpisodeCard';

import type { PatientProfile, AlertServiceConfig } from '../seizure-watch/src/models/types';

// ─── Props ──────────────────────────────────────────────────

interface MonitorScreenProps {
  profile: PatientProfile;
  alertConfig: AlertServiceConfig;
}

// ─── Pantalla ───────────────────────────────────────────────

export const MonitorScreen: React.FC<MonitorScreenProps> = ({
  profile,
  alertConfig,
}) => {
  const {
    detectorState,
    isRunning,
    isInitializing,
    error,
    activeEvent,
    suspectedSince,
    currentHR,
    currentConfidence,
    currentMotionScore,
    currentFrequencyHz,
    recentEpisodes,
    stats,
    start,
    stop,
    refreshStats,
  } = useSeizureDetector({ profile, alertConfig, autoStart: true });

  // Vibrar al detectar crisis
  React.useEffect(() => {
    if (detectorState === 'CONFIRMED') {
      Vibration.vibrate([0, 500, 200, 500, 200, 1000]);
    }
  }, [detectorState]);

  const handleToggle = useCallback(async () => {
    if (isRunning) {
      Alert.alert(
        'Detener monitoreo',
        '¿Estás seguro? El sistema dejará de detectar crisis.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Detener', style: 'destructive', onPress: stop },
        ]
      );
    } else {
      await start();
    }
  }, [isRunning, start, stop]);

  // ─── Colores por estado ──────────────────────────────────

  const stateConfig = getStateConfig(detectorState, isRunning);

  // ─── Render ──────────────────────────────────────────────

  if (isInitializing) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#1D9E75" />
        <Text style={styles.initText}>Iniciando sensores...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Banner de crisis activa ── */}
        {activeEvent && (
          <SeizureAlertBanner event={activeEvent} suspectedSince={suspectedSince} />
        )}

        {/* ── Header con estado ── */}
        <View style={[styles.statusCard, { borderLeftColor: stateConfig.color }]}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: stateConfig.color }]} />
            <Text style={styles.statusLabel}>{stateConfig.label}</Text>
          </View>
          <Text style={styles.patientName}>{profile.name}</Text>
          {!isRunning && (
            <Text style={styles.stoppedNote}>Sistema pausado</Text>
          )}
        </View>

        {/* ── Señales en tiempo real ── */}
        {isRunning && (
          <View style={styles.signalsCard}>
            <Text style={styles.sectionTitle}>Señales en tiempo real</Text>

            <View style={styles.metricsRow}>
              {/* FC */}
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>
                  {currentHR != null ? `${currentHR}` : '—'}
                </Text>
                <Text style={styles.metricUnit}>bpm</Text>
                <Text style={styles.metricLabel}>FC</Text>
              </View>

              {/* Confianza */}
              <View style={styles.metricBox}>
                <Text style={[
                  styles.metricValue,
                  currentConfidence > 0.5 && styles.metricWarning,
                ]}>
                  {Math.round(currentConfidence * 100)}
                </Text>
                <Text style={styles.metricUnit}>%</Text>
                <Text style={styles.metricLabel}>Confianza</Text>
              </View>

              {/* Frecuencia movimiento */}
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>
                  {currentFrequencyHz > 0 ? currentFrequencyHz.toFixed(1) : '—'}
                </Text>
                <Text style={styles.metricUnit}>Hz</Text>
                <Text style={styles.metricLabel}>Frecuencia</Text>
              </View>
            </View>

            {/* Barras de señal de movimiento */}
            <SignalBars
              value={currentMotionScore}
              max={1}
              label="Actividad motora"
              color={currentMotionScore > 0.6 ? '#EF9F27' : '#1D9E75'}
            />
          </View>
        )}

        {/* ── Estadísticas ── */}
        {stats && stats.totalEpisodes > 0 && (
          <View style={styles.statsCard}>
            <Text style={styles.sectionTitle}>Resumen</Text>
            <View style={styles.statsRow}>
              <StatBadge
                value={stats.totalEpisodes}
                label="Total"
                color="#5F5E5A"
              />
              <StatBadge
                value={stats.last30Days}
                label="Últimos 30 días"
                color="#185FA5"
              />
              <StatBadge
                value={stats.last7Days}
                label="Últimos 7 días"
                color={stats.last7Days > 3 ? '#A32D2D' : '#3B6D11'}
              />
            </View>
            {stats.longestFreePeriodDays > 0 && (
              <Text style={styles.freeNote}>
                Mayor período sin crisis: {stats.longestFreePeriodDays} días
              </Text>
            )}
          </View>
        )}

        {/* ── Historial reciente ── */}
        {recentEpisodes.length > 0 && (
          <View style={styles.historySection}>
            <Text style={styles.sectionTitle}>Episodios recientes</Text>
            {recentEpisodes.slice(0, 5).map(ep => (
              <EpisodeCard key={ep.id} episode={ep} />
            ))}
          </View>
        )}

        {/* ── Error ── */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={start}>
              <Text style={styles.retryText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Botón inicio/pausa ── */}
        <TouchableOpacity
          style={[styles.toggleBtn, isRunning && styles.toggleBtnStop]}
          onPress={handleToggle}
        >
          <Text style={styles.toggleBtnText}>
            {isRunning ? 'Pausar monitoreo' : 'Iniciar monitoreo'}
          </Text>
        </TouchableOpacity>

        {/* ── Footer con aviso médico ── */}
        <Text style={styles.disclaimer}>
          Este sistema es una herramienta de apoyo, no un dispositivo médico certificado.
          Consulte siempre con su neurólogo pediátrico.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Subcomponentes inline ──────────────────────────────────

const StatBadge: React.FC<{
  value: number;
  label: string;
  color: string;
}> = ({ value, label, color }) => (
  <View style={[statBadgeStyles.container, { borderTopColor: color }]}>
    <Text style={[statBadgeStyles.value, { color }]}>{value}</Text>
    <Text style={statBadgeStyles.label}>{label}</Text>
  </View>
);

// ─── Estado → configuración visual ─────────────────────────

function getStateConfig(state: string, isRunning: boolean) {
  if (!isRunning) return { color: '#B4B2A9', label: 'Inactivo' };
  switch (state) {
    case 'IDLE':      return { color: '#1D9E75', label: 'Monitoreando' };
    case 'SUSPECTED': return { color: '#EF9F27', label: 'Analizando...' };
    case 'CONFIRMED': return { color: '#E24B4A', label: '⚠️ Crisis detectada' };
    case 'POSTICTAL': return { color: '#378ADD', label: 'Post-ictal — vigilando' };
    default:          return { color: '#B4B2A9', label: 'Iniciando...' };
  }
}

// ─── Estilos ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1EFE8',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  initText: {
    fontSize: 14,
    color: '#5F5E5A',
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 13,
    color: '#5F5E5A',
    fontWeight: '500',
  },
  patientName: {
    fontSize: 20,
    fontWeight: '500',
    color: '#2C2C2A',
  },
  stoppedNote: {
    fontSize: 12,
    color: '#888780',
    marginTop: 4,
  },
  signalsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#888780',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricBox: {
    alignItems: 'center',
    flex: 1,
  },
  metricValue: {
    fontSize: 28,
    fontWeight: '500',
    color: '#2C2C2A',
  },
  metricUnit: {
    fontSize: 11,
    color: '#888780',
    marginTop: -2,
  },
  metricLabel: {
    fontSize: 11,
    color: '#5F5E5A',
    marginTop: 4,
  },
  metricWarning: {
    color: '#E24B4A',
  },
  statsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  freeNote: {
    fontSize: 12,
    color: '#3B6D11',
    textAlign: 'center',
  },
  historySection: {
    gap: 8,
  },
  errorCard: {
    backgroundColor: '#FCEBEB',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#791F1F',
  },
  retryBtn: {
    alignSelf: 'flex-start',
  },
  retryText: {
    fontSize: 13,
    color: '#185FA5',
    fontWeight: '500',
  },
  toggleBtn: {
    backgroundColor: '#1D9E75',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  toggleBtnStop: {
    backgroundColor: '#F1EFE8',
    borderWidth: 1,
    borderColor: '#D3D1C7',
  },
  toggleBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fff',
  },
  disclaimer: {
    fontSize: 11,
    color: '#888780',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 8,
  },
});

const statBadgeStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1EFE8',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderTopWidth: 3,
  },
  value: {
    fontSize: 24,
    fontWeight: '500',
  },
  label: {
    fontSize: 10,
    color: '#5F5E5A',
    textAlign: 'center',
    marginTop: 2,
  },
});

export default MonitorScreen;
