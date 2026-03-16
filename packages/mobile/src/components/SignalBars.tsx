// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — components/SignalBars.tsx
// Barra de progreso animada para señal de movimiento.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

interface Props {
  value: number;   // 0–max
  max:   number;
  label: string;
  color: string;
}

export const SignalBars: React.FC<Props> = ({ value, max, label, color }) => {
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue:        Math.min(value / max, 1),
      duration:       200,
      useNativeDriver: false,
    }).start();
  }, [value, max]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color }]}>{Math.round(value * 100)}%</Text>
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: color },
            {
              width: width.interpolate({
                inputRange:  [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 6 },
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
  },
  label: { fontSize: 12, color: '#5F5E5A' },
  value: { fontSize: 12, fontWeight: '500' },
  track: {
    height:          6,
    backgroundColor: '#D3D1C7',
    borderRadius:    3,
    overflow:        'hidden',
  },
  fill: {
    height:       '100%',
    borderRadius: 3,
  },
});
