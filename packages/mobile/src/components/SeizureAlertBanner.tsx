// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — components/SeizureAlertBanner.tsx
// Banner animado durante crisis activa.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { SeizureEvent }                from '@seizure-watch/core';
import { SeizureType, SeizurePhase }        from '@seizure-watch/core';

const TYPE_LABELS: Record<SeizureType, string> = {
  [SeizureType.TONIC_CLONIC]: 'Tónico-clónica',
  [SeizureType.FOCAL_MOTOR]:  'Focal motora',
  [SeizureType.MYOCLONIC]:    'Mioclónica',
  [SeizureType.TONIC]:        'Tónica',
  [SeizureType.HR_ANOMALY]:   'Anomalía cardíaca',
  [SeizureType.UNKNOWN]:      'Desconocida',
};

interface Props {
  event:          SeizureEvent;
  suspectedSince: number | null;
}

export const SeizureAlertBanner: React.FC<Props> = ({ event, suspectedSince }) => {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.03, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const isConfirmed  = event.phase === SeizurePhase.ICTAL;
  const durationSec  = Math.round((Date.now() - event.startTime) / 1000);

  return (
    <Animated.View
      style={[
        styles.container,
        isConfirmed ? styles.confirmed : styles.suspected,
        { transform: [{ scale: pulse }] },
      ]}
    >
      <Text style={styles.title}>
        {isConfirmed ? '⚠️ CRISIS ACTIVA' : '🔍 Analizando señal...'}
      </Text>

      <Text style={styles.type}>{TYPE_LABELS[event.type]}</Text>

      <View style={styles.row}>
        <Text style={styles.stat}>Duración: <Text style={styles.bold}>{durationSec}s</Text></Text>
        <Text style={styles.stat}>Confianza: <Text style={styles.bold}>{Math.round(event.confidence * 100)}%</Text></Text>
        <Text style={styles.stat}>FC pico: <Text style={styles.bold}>{event.peakHeartRate} bpm</Text></Text>
      </View>

      {isConfirmed && (
        <Text style={styles.emergency}>
          Si supera 5 minutos → llame al 131
        </Text>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    gap: 8,
    marginBottom: 4,
  },
  confirmed: {
    backgroundColor: '#FCEBEB',
    borderWidth: 2,
    borderColor: '#E24B4A',
  },
  suspected: {
    backgroundColor: '#FAEEDA',
    borderWidth: 2,
    borderColor: '#EF9F27',
  },
  title: {
    fontSize: 18,
    fontWeight: '500',
    color: '#501313',
  },
  type: {
    fontSize: 14,
    color: '#791F1F',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  stat: {
    fontSize: 12,
    color: '#791F1F',
  },
  bold: {
    fontWeight: '500',
  },
  emergency: {
    fontSize: 12,
    fontWeight: '500',
    color: '#A32D2D',
    marginTop: 4,
  },
});
