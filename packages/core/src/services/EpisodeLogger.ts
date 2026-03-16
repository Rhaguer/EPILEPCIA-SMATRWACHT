// ─────────────────────────────────────────────────────────────
// @seizure-watch/core — services/EpisodeLogger.ts
// Historial persistente de episodios + estadísticas + reportes.
// ─────────────────────────────────────────────────────────────

import { SeizureEvent, EpisodeRecord, SeizureType } from '../models/types';

export interface EpisodeStats {
  totalEpisodes: number;
  last30Days: number;
  last7Days: number;
  avgDurationMs: number;
  maxDurationMs: number;
  typeBreakdown: Record<SeizureType, number>;
  timeOfDayDistribution: number[];
  longestFreePeriodDays: number;
  lastEpisodeAt: number | null;
}

export interface MedicalReport {
  generatedAt: number;
  patientId: string;
  periodStart: number;
  periodEnd: number;
  stats: EpisodeStats;
  episodes: EpisodeRecord[];
  notes: string;
}

export interface StorageAdapter {
  save(key: string, data: unknown): Promise<void>;
  load(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
  listKeys(prefix?: string): Promise<string[]>;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, string>();
  async save(key: string, data: unknown)  { this.store.set(key, JSON.stringify(data)); }
  async load(key: string)                 { const r = this.store.get(key); return r ? JSON.parse(r) : null; }
  async delete(key: string)               { this.store.delete(key); }
  async listKeys(prefix = '')             { return [...this.store.keys()].filter(k => k.startsWith(prefix)); }
}

export class EpisodeLogger {
  private storage: StorageAdapter;
  private patientId: string;
  private episodes: EpisodeRecord[] = [];
  private initialized = false;
  private readonly KEY_PREFIX = 'seizure_watch';

  constructor(patientId: string, storage?: StorageAdapter) {
    this.patientId = patientId;
    this.storage   = storage ?? new InMemoryStorageAdapter();
  }

  async initialize(): Promise<void> {
    await this.loadFromStorage();
    this.initialized = true;
  }

  async logEpisode(event: SeizureEvent): Promise<EpisodeRecord> {
    if (!this.initialized) await this.initialize();
    const record: EpisodeRecord = {
      ...event, createdAt: Date.now(), syncedToCloud: false, doctorReviewed: false,
    };
    this.episodes.push(record);
    await this.persistAll();
    return record;
  }

  async updateEpisode(id: string, updates: Partial<EpisodeRecord>): Promise<boolean> {
    const idx = this.episodes.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.episodes[idx] = { ...this.episodes[idx], ...updates };
    await this.persistAll();
    return true;
  }

  async markSynced(id: string)                          { await this.updateEpisode(id, { syncedToCloud: true }); }
  async markDoctorReviewed(id: string, notes?: string)  { await this.updateEpisode(id, { doctorReviewed: true, notes }); }
  async getUnsyncedEpisodes()                           { return this.episodes.filter(e => !e.syncedToCloud); }

  getAllEpisodes(): EpisodeRecord[] {
    return [...this.episodes].sort((a, b) => b.startTime - a.startTime);
  }

  getEpisodesInRange(startMs: number, endMs: number): EpisodeRecord[] {
    return this.episodes.filter(e => e.startTime >= startMs && e.startTime <= endMs);
  }

  computeStats(): EpisodeStats {
    if (this.episodes.length === 0) return this.emptyStats();
    const now   = Date.now();
    const day30 = now - 30 * 86_400_000;
    const day7  = now -  7 * 86_400_000;

    const withDur      = this.episodes.filter(e => e.durationMs != null);
    const avgDurationMs = withDur.length
      ? withDur.reduce((a, e) => a + (e.durationMs ?? 0), 0) / withDur.length : 0;
    const maxDurationMs = withDur.length
      ? Math.max(...withDur.map(e => e.durationMs ?? 0)) : 0;

    const typeBreakdown = Object.values(SeizureType).reduce(
      (a, t) => ({ ...a, [t]: 0 }), {} as Record<SeizureType, number>
    );
    this.episodes.forEach(e => { typeBreakdown[e.type]++; });

    const timeDist = Array(24).fill(0);
    this.episodes.forEach(e => { timeDist[new Date(e.startTime).getHours()]++; });

    const lastEpisode = this.episodes.reduce(
      (l, e) => e.startTime > (l?.startTime ?? 0) ? e : l, null as EpisodeRecord | null
    );

    return {
      totalEpisodes: this.episodes.length,
      last30Days: this.episodes.filter(e => e.startTime >= day30).length,
      last7Days:  this.episodes.filter(e => e.startTime >= day7).length,
      avgDurationMs, maxDurationMs, typeBreakdown,
      timeOfDayDistribution: timeDist,
      longestFreePeriodDays: this.computeLongestFreePeriod(),
      lastEpisodeAt: lastEpisode?.startTime ?? null,
    };
  }

  generateMedicalReport(periodDays = 30, additionalNotes = ''): MedicalReport {
    const now      = Date.now();
    const start    = now - periodDays * 86_400_000;
    const episodes = this.getEpisodesInRange(start, now);
    const stats    = this.computeStats();
    return {
      generatedAt: now, patientId: this.patientId,
      periodStart: start, periodEnd: now, stats, episodes,
      notes: this.buildReportNotes(episodes, stats, additionalNotes),
    };
  }

  async exportJSON(): Promise<string> {
    return JSON.stringify(this.generateMedicalReport(365), null, 2);
  }

  // ── Persistencia ─────────────────────────────────────────

  private async persistAll()    { await this.storage.save(`${this.KEY_PREFIX}:episodes:${this.patientId}`, this.episodes); }
  private async loadFromStorage() {
    const data = await this.storage.load(`${this.KEY_PREFIX}:episodes:${this.patientId}`);
    if (Array.isArray(data)) this.episodes = data as EpisodeRecord[];
  }

  // ── Helpers ──────────────────────────────────────────────

  private computeLongestFreePeriod(): number {
    if (this.episodes.length < 2) return 0;
    const sorted = [...this.episodes].sort((a, b) => a.startTime - b.startTime);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].startTime - sorted[i - 1].startTime;
      if (gap > maxGap) maxGap = gap;
    }
    return Math.round(maxGap / 86_400_000);
  }

  private buildReportNotes(episodes: EpisodeRecord[], stats: EpisodeStats, extra: string): string {
    const dominant = Object.entries(stats.typeBreakdown)
      .reduce((a, b) => b[1] > a[1] ? b : a, ['', 0])[0];
    const lines = [
      '=== REPORTE AUTOMÁTICO SeizureWatch ===',
      `Generado: ${new Date().toLocaleString('es-CL')}`,
      `Total en el período: ${episodes.length} episodios`,
      `Tipo más frecuente: ${dominant}`,
      `Duración promedio: ${Math.round(stats.avgDurationMs / 1000)} segundos`,
      `Mayor período sin crisis: ${stats.longestFreePeriodDays} días`,
      '',
      'AVISO: Este sistema es de apoyo, no diagnóstico.',
      'Datos a revisar por neurólogo pediátrico.',
    ];
    if (extra) lines.push('', 'Notas adicionales:', extra);
    return lines.join('\n');
  }

  private emptyStats(): EpisodeStats {
    return {
      totalEpisodes: 0, last30Days: 0, last7Days: 0,
      avgDurationMs: 0, maxDurationMs: 0,
      typeBreakdown: Object.values(SeizureType).reduce(
        (a, t) => ({ ...a, [t]: 0 }), {} as Record<SeizureType, number>
      ),
      timeOfDayDistribution: Array(24).fill(0),
      longestFreePeriodDays: 0, lastEpisodeAt: null,
    };
  }

  getEpisodeCount(): number { return this.episodes.length; }
}
