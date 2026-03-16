// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — screens/MonitorScreen.tsx
// Pantalla principal de monitoreo en tiempo real.
// ─────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, SafeAreaView,
  ActivityIndicator, Vibration, Alert,
} from 'react-native';

import type { PatientProfile, AlertServiceConfig } from '@seizure-watch/core';
import type { DetectorState }                      from '@seizure-watch/core';

import { useSeizureDetector }    from '@hooks/useSeizureDetector';
import { SeizureAlertBanner }    from '@components/SeizureAlertBanner';
import { SignalBars }            from '@components/SignalBars';
import { EpisodeCard }           from '@components/EpisodeCard';

interface Props {
  profile:     PatientProfile;
  alertConfig: AlertServiceConfig;
}

export const MonitorScreen: React.FC<Props> = ({ profile, alertConfig }) => {
  const {
    detectorState, isRunning, isInitializing, error,
    activeEvent, suspectedSince,
    currentHR, currentConfidence, currentMotionScore, currentFrequencyHz,
    recentEpisodes, stats,
    start, stop, refreshStats,
  } = useSeizureDetector({ profile, alertConfig, autoStart: true });

  // Vibrar al confirmar crisis
  React.useEffect(() => {
    if (detectorState === 'CONFIRMED')
      Vibration.vibrate([0, 500, 200, 500, 200, 1000]);
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

  const stateConfig = getStateConfig(detectorState, isRunning);

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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Banner crisis activa */}
        {activeEvent && (
          <SeizureAlertBanner event={activeEvent} suspectedSince={suspectedSince} />
        )}

        {/* Estado del sistema */}
        <View style={[styles.statusCard, { borderLeftColor: stateConfig.color }]}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: stateConfig.color }]} />
            <Text style={styles.statusLabel}>{stateConfig.label}</Text>
          </View>
          <Text style={styles.patientName}>{profile.name}</Text>
          {!isRunning && <Text style={styles.stoppedNote}>Sistema pausado</Text>}
        </View>

        {/* Señales en tiempo real */}
        {isRunning && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Señales en tiempo real</Text>
            <View style={styles.metricsRow}>
              <MetricBox value={currentHR != null ? `${currentHR}` : '—'} unit="bpm"  label="FC" />
              <MetricBox
                value={Math.round(currentConfidence * 100).toString()}
                unit="%"
                label="Confianza"
                warn={currentConfidence > 0.5}
              />
              <MetricBox
                value={currentFrequencyHz > 0 ? currentFrequencyHz.toFixed(1) : '—'}
                unit="Hz"
                label="Frecuencia"
              />
            </View>
            <SignalBars
              value={currentMotionScore}
              max={1}
              label="Actividad motora"
              color={currentMotionScore > 0.6 ? '#EF9F27' : '#1D9E75'}
            />
          </View>
        )}

        {/* Estadísticas */}
        {stats && stats.totalEpisodes > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Resumen</Text>
            <View style={styles.statsRow}>
              <StatBadge value={stats.totalEpisodes} label="Total"           color="#5F5E5A" />
              <StatBadge value={stats.last30Days}    label="Últimos 30 días" color="#185FA5" />
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

        {/* Historial reciente */}
        {recentEpisodes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Episodios recientes</Text>
            {recentEpisodes.slice(0, 5).map(ep => (
              <EpisodeCard key={ep.id} episode={ep} />
            ))}
          </View>
        )}

        {/* Error */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <TouchableOpacity onPress={start}>
              <Text style={styles.retryText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Toggle */}
        <TouchableOpacity
          style={[styles.toggleBtn, isRunning && styles.toggleBtnStop]}
          onPress={handleToggle}
        >
          <Text style={[styles.toggleText, isRunning && styles.toggleTextStop]}>
            {isRunning ? 'Pausar monitoreo' : 'Iniciar monitoreo'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Herramienta de apoyo — no reemplaza supervisión médica.
          Revisar con neurólogo pediátrico.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Sub-componentes locales ──────────────────────────────────

const MetricBox: React.FC<{
  value: string; unit: string; label: string; warn?: boolean;
}> = ({ value, unit, label, warn }) => (
  <View style={metricStyles.box}>
    <Text style={[metricStyles.value, warn && metricStyles.warn]}>{value}</Text>
    <Text style={metricStyles.unit}>{unit}</Text>
    <Text style={metricStyles.label}>{label}</Text>
  </View>
);

const StatBadge: React.FC<{
  value: number; label: string; color: string;
}> = ({ value, label, color }) => (
  <View style={[badgeStyles.container, { borderTopColor: color }]}>
    <Text style={[badgeStyles.value, { color }]}>{value}</Text>
    <Text style={badgeStyles.label}>{label}</Text>
  </View>
);

function getStateConfig(state: DetectorState | string, isRunning: boolean) {
  if (!isRunning) return { color: '#B4B2A9', label: 'Inactivo' };
  const map: Record<string, { color: string; label: string }> = {
    IDLE:      { color: '#1D9E75', label: 'Monitoreando' },
    SUSPECTED: { color: '#EF9F27', label: 'Analizando...' },
    CONFIRMED: { color: '#E24B4A', label: '⚠️ Crisis detectada' },
    POSTICTAL: { color: '#378ADD', label: 'Post-ictal — vigilando' },
  };
  return map[state] ?? { color: '#B4B2A9', label: 'Iniciando...' };
}

// ── Estilos ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F1EFE8' },
  scroll:      { padding: 16, paddingBottom: 40, gap: 12 },
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  initText:    { fontSize: 14, color: '#5F5E5A' },
  card:        { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 12 },
  section:     { gap: 8 },
  statusCard:  { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderLeftWidth: 4 },
  statusRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  dot:         { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 13, color: '#5F5E5A', fontWeight: '500' },
  patientName: { fontSize: 20, fontWeight: '500', color: '#2C2C2A' },
  stoppedNote: { fontSize: 12, color: '#888780', marginTop: 4 },
  sectionTitle:{ fontSize: 12, fontWeight: '500', color: '#888780',
                 textTransform: 'uppercase', letterSpacing: 0.5 },
  metricsRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  statsRow:    { flexDirection: 'row', gap: 10 },
  freeNote:    { fontSize: 12, color: '#3B6D11', textAlign: 'center' },
  errorCard:   { backgroundColor: '#FCEBEB', borderRadius: 12, padding: 16, gap: 8 },
  errorText:   { fontSize: 13, color: '#791F1F' },
  retryText:   { fontSize: 13, color: '#185FA5', fontWeight: '500' },
  toggleBtn:   { backgroundColor: '#1D9E75', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  toggleBtnStop: { backgroundColor: '#F1EFE8', borderWidth: 1, borderColor: '#D3D1C7' },
  toggleText:  { fontSize: 15, fontWeight: '500', color: '#fff' },
  toggleTextStop: { color: '#2C2C2A' },
  disclaimer:  { fontSize: 11, color: '#888780', textAlign: 'center', lineHeight: 16, marginTop: 8 },
});

const metricStyles = StyleSheet.create({
  box:   { alignItems: 'center', flex: 1 },
  value: { fontSize: 28, fontWeight: '500', color: '#2C2C2A' },
  unit:  { fontSize: 11, color: '#888780', marginTop: -2 },
  label: { fontSize: 11, color: '#5F5E5A', marginTop: 4 },
  warn:  { color: '#E24B4A' },
});

const badgeStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1EFE8', borderRadius: 8,
               padding: 10, alignItems: 'center', borderTopWidth: 3 },
  value:     { fontSize: 24, fontWeight: '500' },
  label:     { fontSize: 10, color: '#5F5E5A', textAlign: 'center', marginTop: 2 },
});

export default MonitorScreen;
