// ============================================================
// components/index.tsx
// Componentes de UI reutilizables para SeizureWatch RN.
// ============================================================

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
} from 'react-native';
import type { SeizureEvent } from '../seizure-watch/src/models/types';
import { SeizureType } from '../seizure-watch/src/models/types';

// ─── Etiquetas legibles ─────────────────────────────────────

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

// ─── SeizureAlertBanner ─────────────────────────────────────
// Banner animado que aparece cuando se detecta una crisis activa

interface SeizureAlertBannerProps {
  event: SeizureEvent;
  suspectedSince: number | null;
}

export const SeizureAlertBanner: React.FC<SeizureAlertBannerProps> = ({
  event,
  suspectedSince,
}) => {
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

  const durationSec = Math.round((Date.now() - event.startTime) / 1000);
  const isConfirmed = event.phase === 'ictal';

  return (
    <Animated.View
      style={[
        bannerStyles.container,
        { transform: [{ scale: pulse }] },
        isConfirmed ? bannerStyles.confirmed : bannerStyles.suspected,
      ]}
    >
      <Text style={bannerStyles.title}>
        {isConfirmed ? '⚠️ CRISIS ACTIVA' : '🔍 Analizando...'}
      </Text>
      <Text style={bannerStyles.type}>{TYPE_LABELS[event.type]}</Text>
      <View style={bannerStyles.row}>
        <Text style={bannerStyles.stat}>
          Duración: <Text style={bannerStyles.statVal}>{durationSec}s</Text>
        </Text>
        <Text style={bannerStyles.stat}>
          Confianza: <Text style={bannerStyles.statVal}>
            {Math.round(event.confidence * 100)}%
          </Text>
        </Text>
        <Text style={bannerStyles.stat}>
          FC: <Text style={bannerStyles.statVal}>{event.avgHeartRate} bpm</Text>
        </Text>
      </View>
      {isConfirmed && (
        <Text style={bannerStyles.emergency}>
          Si la crisis supera 5 minutos → llame al 131
        </Text>
      )}
    </Animated.View>
  );
};

const bannerStyles = StyleSheet.create({
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
  statVal: {
    fontWeight: '500',
  },
  emergency: {
    fontSize: 12,
    color: '#A32D2D',
    fontWeight: '500',
    marginTop: 4,
  },
});

// ─── SignalBars ──────────────────────────────────────────────
// Barra de progreso animada para señales de movimiento

interface SignalBarsProps {
  value: number;    // 0–max
  max: number;
  label: string;
  color: string;
}

export const SignalBars: React.FC<SignalBarsProps> = ({ value, max, label, color }) => {
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: Math.min(value / max, 1),
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [value, max]);

  return (
    <View style={barStyles.container}>
      <View style={barStyles.header}>
        <Text style={barStyles.label}>{label}</Text>
        <Text style={[barStyles.value, { color }]}>
          {Math.round(value * 100)}%
        </Text>
      </View>
      <View style={barStyles.track}>
        <Animated.View
          style={[
            barStyles.fill,
            { backgroundColor: color },
            { width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
    </View>
  );
};

const barStyles = StyleSheet.create({
  container: { gap: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 12, color: '#5F5E5A' },
  value: { fontSize: 12, fontWeight: '500' },
  track: {
    height: 6,
    backgroundColor: '#D3D1C7',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
});

// ─── EpisodeCard ─────────────────────────────────────────────
// Tarjeta compacta para el historial de episodios

interface EpisodeCardProps {
  episode: SeizureEvent;
  onPress?: () => void;
}

export const EpisodeCard: React.FC<EpisodeCardProps> = ({ episode, onPress }) => {
  const color = TYPE_COLORS[episode.type];
  const date = new Date(episode.startTime);
  const timeStr = date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  const duration = episode.durationMs
    ? `${Math.round(episode.durationMs / 1000)}s`
    : 'En curso';

  return (
    <TouchableOpacity
      style={[cardStyles.container, { borderLeftColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={cardStyles.row}>
        <View>
          <Text style={[cardStyles.type, { color }]}>{TYPE_LABELS[episode.type]}</Text>
          <Text style={cardStyles.time}>{dateStr} · {timeStr}</Text>
        </View>
        <View style={cardStyles.right}>
          <Text style={cardStyles.duration}>{duration}</Text>
          <Text style={cardStyles.hr}>{episode.peakHeartRate} bpm pico</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const cardStyles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  type: {
    fontSize: 14,
    fontWeight: '500',
  },
  time: {
    fontSize: 12,
    color: '#888780',
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    gap: 2,
  },
  duration: {
    fontSize: 15,
    fontWeight: '500',
    color: '#2C2C2A',
  },
  hr: {
    fontSize: 11,
    color: '#888780',
  },
});
