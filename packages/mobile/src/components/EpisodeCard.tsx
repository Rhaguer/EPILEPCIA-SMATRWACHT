// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — components/EpisodeCard.tsx
// Tarjeta compacta de un episodio en el historial.
// ─────────────────────────────────────────────────────────────

import React             from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { SeizureEvent } from '@seizure-watch/core';
import { SeizureType }       from '@seizure-watch/core';

const TYPE_LABELS: Record<SeizureType, string> = {
  [SeizureType.TONIC_CLONIC]: 'Tónico-clónica',
  [SeizureType.FOCAL_MOTOR]:  'Focal motora',
  [SeizureType.MYOCLONIC]:    'Mioclónica',
  [SeizureType.TONIC]:        'Tónica',
  [SeizureType.HR_ANOMALY]:   'Anomalía cardíaca',
  [SeizureType.UNKNOWN]:      'Desconocida',
};

const TYPE_COLORS: Record<SeizureType, string> = {
  [SeizureType.TONIC_CLONIC]: '#A32D2D',
  [SeizureType.FOCAL_MOTOR]:  '#854F0B',
  [SeizureType.MYOCLONIC]:    '#993556',
  [SeizureType.TONIC]:        '#993C1D',
  [SeizureType.HR_ANOMALY]:   '#185FA5',
  [SeizureType.UNKNOWN]:      '#5F5E5A',
};

interface Props {
  episode: SeizureEvent;
  onPress?: () => void;
}

export const EpisodeCard: React.FC<Props> = ({ episode, onPress }) => {
  const color    = TYPE_COLORS[episode.type];
  const date     = new Date(episode.startTime);
  const timeStr  = date.toLocaleTimeString ('es-CL', { hour: '2-digit', minute: '2-digit' });
  const dateStr  = date.toLocaleDateString ('es-CL', { day: 'numeric', month: 'short' });
  const duration = episode.durationMs
    ? `${Math.round(episode.durationMs / 1000)}s`
    : 'En curso';

  return (
    <TouchableOpacity
      style={[styles.container, { borderLeftColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        <View>
          <Text style={[styles.type, { color }]}>{TYPE_LABELS[episode.type]}</Text>
          <Text style={styles.time}>{dateStr} · {timeStr}</Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.duration}>{duration}</Text>
          <Text style={styles.hr}>{episode.peakHeartRate} bpm pico</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius:    10,
    padding:         12,
    borderLeftWidth: 3,
  },
  row: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  type:     { fontSize: 14, fontWeight: '500' },
  time:     { fontSize: 12, color: '#888780', marginTop: 2 },
  right:    { alignItems: 'flex-end', gap: 2 },
  duration: { fontSize: 15, fontWeight: '500', color: '#2C2C2A' },
  hr:       { fontSize: 11, color: '#888780' },
});
