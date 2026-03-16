// ============================================================
// EPISODE LOGGER
// Almacena y gestiona el historial de episodios convulsivos.
// Soporta: almacenamiento local + sincronización con nube.
// Genera reportes para el neurólogo/pediatra.
// ============================================================

import { SeizureEvent, EpisodeRecord, SeizureType, SeizurePhase } from '../models/types';

export interface EpisodeStats {
  totalEpisodes: number;
  last30Days: number;
  last7Days: number;
  avgDurationMs: number;
  maxDurationMs: number;
  typeBreakdown: Record<SeizureType, number>;
  timeOfDayDistribution: number[];  // 24 slots, uno por hora
  longestFreePeriodDays: number;     // días sin crisis
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

// Adaptador de almacenamiento en memoria (para entornos sin persistencia)
export class InMemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, string>();

  async save(key: string, data: unknown): Promise<void> {
    this.store.set(key, JSON.stringify(data));
  }

  async load(key: string): Promise<unknown | null> {
    const raw = this.store.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async listKeys(prefix = ''): Promise<string[]> {
    return Array.from(this.store.keys()).filter(k => k.startsWith(prefix));
  }
}

// Adaptador localStorage (navegador / React Native AsyncStorage-compatible)
export class LocalStorageAdapter implements StorageAdapter {
  async save(key: string, data: unknown): Promise<void> {
    localStorage.setItem(key, JSON.stringify(data));
  }

  async load(key: string): Promise<unknown | null> {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async listKeys(prefix = ''): Promise<string[]> {
    return Object.keys(localStorage).filter(k => k.startsWith(prefix));
  }
}

export class EpisodeLogger {
  private storage: StorageAdapter;
  private patientId: string;
  private episodes: EpisodeRecord[] = [];
  private initialized = false;

  private readonly KEY_PREFIX = 'seizure_watch';

  constructor(patientId: string, storage?: StorageAdapter) {
    this.patientId = patientId;
    this.storage = storage ?? new InMemoryStorageAdapter();
  }

  async initialize(): Promise<void> {
    await this.loadFromStorage();
    this.initialized = true;
  }

  // ─── API Principal ──────────────────────────────────────

  async logEpisode(event: SeizureEvent): Promise<EpisodeRecord> {
    if (!this.initialized) await this.initialize();

    const record: EpisodeRecord = {
      ...event,
      createdAt: Date.now(),
      syncedToCloud: false,
      doctorReviewed: false,
    };

    this.episodes.push(record);
    await this.persistAll();

    console.log(`[EpisodeLogger] Episode logged: ${record.id} (${record.type})`);
    return record;
  }

  async updateEpisode(id: string, updates: Partial<EpisodeRecord>): Promise<boolean> {
    const idx = this.episodes.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.episodes[idx] = { ...this.episodes[idx], ...updates };
    await this.persistAll();
    return true;
  }

  async markSynced(id: string): Promise<void> {
    await this.updateEpisode(id, { syncedToCloud: true });
  }

  async markDoctorReviewed(id: string, notes?: string): Promise<void> {
    await this.updateEpisode(id, {
      doctorReviewed: true,
      notes: notes ?? this.episodes.find(e => e.id === id)?.notes,
    });
  }

  async getUnsyncedEpisodes(): Promise<EpisodeRecord[]> {
    return this.episodes.filter(e => !e.syncedToCloud);
  }

  // ─── Consultas y estadísticas ───────────────────────────

  getAllEpisodes(): EpisodeRecord[] {
    return [...this.episodes].sort((a, b) => b.startTime - a.startTime);
  }

  getEpisodesInRange(startMs: number, endMs: number): EpisodeRecord[] {
    return this.episodes.filter(
      e => e.startTime >= startMs && e.startTime <= endMs
    );
  }

  computeStats(): EpisodeStats {
    if (this.episodes.length === 0) {
      return this.emptyStats();
    }

    const now = Date.now();
    const day30 = now - 30 * 24 * 3_600_000;
    const day7  = now - 7  * 24 * 3_600_000;

    const last30 = this.episodes.filter(e => e.startTime >= day30);
    const last7  = this.episodes.filter(e => e.startTime >= day7);

    const withDuration = this.episodes.filter(e => e.durationMs != null);
    const avgDurationMs = withDuration.length
      ? withDuration.reduce((a, e) => a + (e.durationMs ?? 0), 0) / withDuration.length
      : 0;
    const maxDurationMs = withDuration.length
      ? Math.max(...withDuration.map(e => e.durationMs ?? 0))
      : 0;

    const typeBreakdown = Object.values(SeizureType).reduce(
      (acc, t) => ({ ...acc, [t]: 0 }),
      {} as Record<SeizureType, number>
    );
    this.episodes.forEach(e => { typeBreakdown[e.type]++; });

    const timeDistribution = Array(24).fill(0);
    this.episodes.forEach(e => {
      const hour = new Date(e.startTime).getHours();
      timeDistribution[hour]++;
    });

    const longestFreePeriodDays = this.computeLongestFreePeriod();

    const lastEpisode = this.episodes.reduce((latest, e) =>
      e.startTime > (latest?.startTime ?? 0) ? e : latest, null as EpisodeRecord | null
    );

    return {
      totalEpisodes: this.episodes.length,
      last30Days: last30.length,
      last7Days: last7.length,
      avgDurationMs,
      maxDurationMs,
      typeBreakdown,
      timeOfDayDistribution: timeDistribution,
      longestFreePeriodDays,
      lastEpisodeAt: lastEpisode?.startTime ?? null,
    };
  }

  generateMedicalReport(
    periodDays = 30,
    additionalNotes = ''
  ): MedicalReport {
    const now = Date.now();
    const start = now - periodDays * 24 * 3_600_000;
    const periodEpisodes = this.getEpisodesInRange(start, now);
    const stats = this.computeStats();

    const notes = this.buildReportNotes(periodEpisodes, stats, additionalNotes);

    return {
      generatedAt: now,
      patientId: this.patientId,
      periodStart: start,
      periodEnd: now,
      stats,
      episodes: periodEpisodes,
      notes,
    };
  }

  // ─── Persistencia ───────────────────────────────────────

  private async persistAll(): Promise<void> {
    const key = `${this.KEY_PREFIX}:episodes:${this.patientId}`;
    await this.storage.save(key, this.episodes);
  }

  private async loadFromStorage(): Promise<void> {
    const key = `${this.KEY_PREFIX}:episodes:${this.patientId}`;
    const data = await this.storage.load(key);
    if (Array.isArray(data)) {
      this.episodes = data as EpisodeRecord[];
    }
  }

  // Exporta todo como JSON (para enviar al médico o respaldo)
  async exportJSON(): Promise<string> {
    const report = this.generateMedicalReport(365);
    return JSON.stringify(report, null, 2);
  }

  // ─── Helpers privados ───────────────────────────────────

  private computeLongestFreePeriod(): number {
    if (this.episodes.length < 2) return 0;
    const sorted = [...this.episodes].sort((a, b) => a.startTime - b.startTime);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].startTime - sorted[i - 1].startTime;
      if (gap > maxGap) maxGap = gap;
    }
    return Math.round(maxGap / (24 * 3_600_000));
  }

  private buildReportNotes(
    episodes: EpisodeRecord[],
    stats: EpisodeStats,
    extra: string
  ): string {
    const lines: string[] = [
      '=== REPORTE AUTOMÁTICO SeizureWatch ===',
      `Generado: ${new Date().toLocaleString('es-CL')}`,
      `Total en el período: ${episodes.length} episodios`,
      `Tipo más frecuente: ${this.dominantType(stats.typeBreakdown)}`,
      `Duración promedio: ${Math.round(stats.avgDurationMs / 1000)} segundos`,
      `Mayor período sin crisis: ${stats.longestFreePeriodDays} días`,
      '',
      'AVISO: Este sistema es de apoyo, no diagnóstico.',
      'Los datos deben ser revisados por un neurólogo pediátrico.',
    ];
    if (extra) lines.push('', 'Notas adicionales:', extra);
    return lines.join('\n');
  }

  private dominantType(breakdown: Record<SeizureType, number>): string {
    const entries = Object.entries(breakdown);
    const dominant = entries.reduce((a, b) => (b[1] > a[1] ? b : a), entries[0]);
    return dominant?.[0] ?? 'Desconocido';
  }

  private emptyStats(): EpisodeStats {
    return {
      totalEpisodes: 0,
      last30Days: 0,
      last7Days: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      typeBreakdown: Object.values(SeizureType).reduce(
        (a, t) => ({ ...a, [t]: 0 }),
        {} as Record<SeizureType, number>
      ),
      timeOfDayDistribution: Array(24).fill(0),
      longestFreePeriodDays: 0,
      lastEpisodeAt: null,
    };
  }

  getEpisodeCount(): number { return this.episodes.length; }
}
