// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — screens/HistoryScreen.tsx
// Historial completo de episodios + estadísticas.
// ─────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  SafeAreaView, TouchableOpacity, Share,
} from 'react-native';

import { EpisodeCard }    from '@components/EpisodeCard';
import type { SeizureEvent, EpisodeStats } from '@seizure-watch/core';

interface Props {
  episodes: SeizureEvent[];
  stats:    EpisodeStats | null;
  onExport?: () => Promise<string>;
}

type Filter = 'all' | '7d' | '30d';

export const HistoryScreen: React.FC<Props> = ({ episodes, stats, onExport }) => {
  const [filter, setFilter] = useState<Filter>('all');

  const now      = Date.now();
  const filtered = episodes.filter(e => {
    if (filter === '7d')  return e.startTime >= now - 7  * 86_400_000;
    if (filter === '30d') return e.startTime >= now - 30 * 86_400_000;
    return true;
  });

  const handleExport = async () => {
    if (!onExport) return;
    try {
      const json = await onExport();
      await Share.share({ message: json, title: 'Reporte SeizureWatch' });
    } catch (err) {
      console.error('[HistoryScreen] Export error:', err);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Filtros */}
      <View style={styles.filters}>
        {(['all', '7d', '30d'] as Filter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? 'Todos' : f === '7d' ? 'Últimos 7 días' : 'Últimos 30 días'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats rápidas */}
      {stats && (
        <View style={styles.statsRow}>
          <StatBox label="Total"     value={filtered.length.toString()} />
          <StatBox
            label="Promedio"
            value={stats.avgDurationMs > 0
              ? `${Math.round(stats.avgDurationMs / 1000)}s`
              : '—'}
          />
          <StatBox
            label="Sin crisis"
            value={`${stats.longestFreePeriodDays}d`}
            color="#3B6D11"
          />
        </View>
      )}

      {/* Lista */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Sin episodios registrados</Text>
          </View>
        }
        renderItem={({ item }) => <EpisodeCard episode={item} />}
      />

      {/* Exportar */}
      {onExport && episodes.length > 0 && (
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
          <Text style={styles.exportText}>Exportar reporte para médico</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

const StatBox: React.FC<{ label: string; value: string; color?: string }> = ({
  label, value, color = '#2C2C2A',
}) => (
  <View style={statStyles.box}>
    <Text style={[statStyles.value, { color }]}>{value}</Text>
    <Text style={statStyles.label}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#F1EFE8' },
  filters:    { flexDirection: 'row', padding: 12, gap: 8 },
  filterBtn:  { flex: 1, paddingVertical: 8, borderRadius: 8,
                backgroundColor: '#fff', alignItems: 'center',
                borderWidth: 1, borderColor: '#D3D1C7' },
  filterActive: { backgroundColor: '#2C2C2A', borderColor: '#2C2C2A' },
  filterText:   { fontSize: 12, color: '#5F5E5A' },
  filterTextActive: { color: '#fff', fontWeight: '500' },
  statsRow:   { flexDirection: 'row', paddingHorizontal: 12, gap: 8, marginBottom: 8 },
  list:       { padding: 12, paddingTop: 4, gap: 8, paddingBottom: 100 },
  separator:  { height: 0 },
  empty:      { alignItems: 'center', paddingTop: 48 },
  emptyText:  { fontSize: 14, color: '#888780' },
  exportBtn:  { margin: 16, padding: 14, backgroundColor: '#185FA5',
                borderRadius: 12, alignItems: 'center' },
  exportText: { color: '#fff', fontWeight: '500', fontSize: 14 },
});

const statStyles = StyleSheet.create({
  box:   { flex: 1, backgroundColor: '#fff', borderRadius: 10,
           padding: 10, alignItems: 'center' },
  value: { fontSize: 22, fontWeight: '500' },
  label: { fontSize: 11, color: '#888780', marginTop: 2 },
});

export default HistoryScreen;
