// ─────────────────────────────────────────────────────────────
// @seizure-watch/core — services/AlertService.ts
// Envío de alertas a cuidadores: Push / SMS / Email.
// Escalamiento automático si no hay acuse de recibo.
// ─────────────────────────────────────────────────────────────

import {
  SeizureEvent,
  AlertPayload,
  CaregiverContact,
  PatientProfile,
  SeizureType,
  GeolocationCoords,
} from '../models/types';

export interface AlertServiceConfig {
  pushEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  smsApiUrl?: string;
  pushApiUrl?: string;
  emailApiUrl?: string;
  escalationDelayMs: number;
  maxRetries: number;
}

export interface AlertRecord {
  alertId: string;
  eventId: string;
  caregiverId: string;
  channel: 'push' | 'sms' | 'email';
  sentAt: number;
  acknowledged: boolean;
  acknowledgedAt?: number;
  retryCount: number;
}

export type GetLocationFn = () => Promise<GeolocationCoords | null>;

const SEIZURE_TYPE_LABELS: Record<SeizureType, string> = {
  [SeizureType.TONIC_CLONIC]: 'Tónico-clónica (gran mal)',
  [SeizureType.FOCAL_MOTOR]:  'Focal motora',
  [SeizureType.MYOCLONIC]:    'Mioclónica',
  [SeizureType.TONIC]:        'Tónica',
  [SeizureType.HR_ANOMALY]:   'Anomalía cardíaca (posible ausencia)',
  [SeizureType.UNKNOWN]:      'Tipo desconocido',
};

export class AlertService {
  private config: AlertServiceConfig;
  private alertHistory: AlertRecord[]      = [];
  private escalationTimers                 = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingAcknowledgment            = new Set<string>();
  private getLocation: GetLocationFn;

  constructor(config: AlertServiceConfig, getLocation: GetLocationFn) {
    this.config      = config;
    this.getLocation = getLocation;
  }

  async sendSeizureAlert(event: SeizureEvent, profile: PatientProfile): Promise<void> {
    const location = await this.getLocation().catch(() => null);
    const payload  = this.buildPayload(event, profile, location);
    const sorted   = [...profile.caregivers].sort((a, b) => a.priority - b.priority);
    const primary  = sorted[0];

    if (primary) {
      await this.alertCaregiver(primary, payload);
      this.pendingAcknowledgment.add(`${event.id}:${primary.id}`);
      if (sorted.length > 1) this.scheduleEscalation(sorted, 1, payload, event.id);
    }
  }

  async sendSeizureEndedAlert(event: SeizureEvent, profile: PatientProfile): Promise<void> {
    const duration = event.durationMs ? this.formatDuration(event.durationMs) : 'duración desconocida';
    const payload: AlertPayload = {
      eventId: event.id, patientName: profile.name, patientId: profile.id,
      timestamp: event.endTime ?? Date.now(), seizureType: event.type,
      confidence: event.confidence, durationMs: event.durationMs,
      message: `✅ CRISIS FINALIZADA — ${profile.name}\nDuración: ${duration}\n`
             + `Tipo: ${SEIZURE_TYPE_LABELS[event.type]}\n`
             + `Verifique el estado del menor y contacte a su médico.`,
    };
    await Promise.all(profile.caregivers.map(c => this.alertCaregiver(c, payload, true)));
    this.cancelEscalation(event.id);
  }

  async sendSudepRiskAlert(event: SeizureEvent, profile: PatientProfile): Promise<void> {
    const location = await this.getLocation().catch(() => null);
    const payload: AlertPayload = {
      eventId: `sudep-${event.id}`, patientName: profile.name, patientId: profile.id,
      timestamp: Date.now(), seizureType: event.type, confidence: 1,
      location: location ?? undefined,
      message: `🚨 ALERTA CRÍTICA — ${profile.name}\n`
             + `Frecuencia cardíaca muy baja tras crisis.\nLLAME AL 131 INMEDIATAMENTE.\n`
             + (location ? `Ubicación: https://maps.google.com/?q=${location.lat},${location.lon}` : ''),
    };
    await Promise.all(profile.caregivers.map(c => this.alertCaregiver(c, payload)));
  }

  acknowledgeAlert(eventId: string, caregiverId: string): void {
    this.pendingAcknowledgment.delete(`${eventId}:${caregiverId}`);
    const record = this.alertHistory.find(r => r.eventId === eventId && r.caregiverId === caregiverId);
    if (record) { record.acknowledged = true; record.acknowledgedAt = Date.now(); }
    this.cancelEscalation(eventId);
  }

  getAlertHistory(): AlertRecord[] { return [...this.alertHistory]; }

  // ── Privados ─────────────────────────────────────────────

  private async alertCaregiver(
    caregiver: CaregiverContact, payload: AlertPayload, isEnd = false
  ): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (this.config.pushEnabled && caregiver.notifyViaPush)
      tasks.push(this.sendPush(caregiver, payload, isEnd));
    if (this.config.smsEnabled && caregiver.notifyViaSMS)
      tasks.push(this.sendSMS(caregiver, payload));
    if (this.config.emailEnabled && caregiver.email)
      tasks.push(this.sendEmail(caregiver, payload));
    await Promise.allSettled(tasks);
  }

  private async sendPush(c: CaregiverContact, p: AlertPayload, isEnd: boolean): Promise<void> {
    if (!this.config.pushApiUrl) return;
    const record = this.createRecord(p.eventId, c.id, 'push');
    try {
      const res = await fetch(this.config.pushApiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caregiverId: c.id,
          title: isEnd ? `Crisis finalizada — ${p.patientName}` : `⚠️ CRISIS DETECTADA — ${p.patientName}`,
          body: p.message,
          data: { eventId: p.eventId, type: p.seizureType, timestamp: p.timestamp },
          priority: isEnd ? 'normal' : 'high',
        }),
      });
      if (res.ok) this.alertHistory.push({ ...record });
    } catch (err) {
      console.error('[AlertService] Push failed:', err);
      if (record.retryCount < this.config.maxRetries)
        setTimeout(() => { record.retryCount++; this.sendPush(c, p, isEnd); },
                   5_000 * (record.retryCount + 1));
    }
  }

  private async sendSMS(c: CaregiverContact, p: AlertPayload): Promise<void> {
    if (!this.config.smsApiUrl) return;
    const record = this.createRecord(p.eventId, c.id, 'sms');
    try {
      const res = await fetch(this.config.smsApiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: c.phone, message: p.message.substring(0, 160) }),
      });
      if (res.ok) this.alertHistory.push({ ...record });
    } catch (err) { console.error('[AlertService] SMS failed:', err); }
  }

  private async sendEmail(c: CaregiverContact, p: AlertPayload): Promise<void> {
    if (!this.config.emailApiUrl || !c.email) return;
    const record = this.createRecord(p.eventId, c.id, 'email');
    try {
      const res = await fetch(this.config.emailApiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: c.email,
          subject: `[SeizureWatch] Crisis detectada — ${p.patientName}`,
          text: p.message,
        }),
      });
      if (res.ok) this.alertHistory.push({ ...record });
    } catch (err) { console.error('[AlertService] Email failed:', err); }
  }

  private scheduleEscalation(
    caregivers: CaregiverContact[], idx: number,
    payload: AlertPayload, eventId: string
  ): void {
    if (idx >= caregivers.length) return;
    const id = setTimeout(async () => {
      if (this.pendingAcknowledgment.has(`${eventId}:${caregivers[idx - 1].id}`)) {
        await this.alertCaregiver(caregivers[idx], payload);
        this.pendingAcknowledgment.add(`${eventId}:${caregivers[idx].id}`);
        this.scheduleEscalation(caregivers, idx + 1, payload, eventId);
      }
    }, this.config.escalationDelayMs);
    this.escalationTimers.set(`${eventId}:${idx}`, id);
  }

  private cancelEscalation(eventId: string): void {
    for (const [key, timer] of this.escalationTimers.entries()) {
      if (key.startsWith(eventId)) { clearTimeout(timer); this.escalationTimers.delete(key); }
    }
  }

  private buildPayload(
    event: SeizureEvent, profile: PatientProfile, location: GeolocationCoords | null
  ): AlertPayload {
    const time = new Date(event.startTime).toLocaleTimeString('es-CL');
    let msg = `⚠️ CRISIS DETECTADA — ${profile.name}\nHora: ${time}\n`
            + `Tipo: ${SEIZURE_TYPE_LABELS[event.type]}\n`
            + `Confianza: ${Math.round(event.confidence * 100)}%\n`
            + `FC: ${event.avgHeartRate} bpm\n\n`
            + `Si la crisis supera 5 minutos, llame al 131.`;
    if (location) msg += `\n\nUbicación: https://maps.google.com/?q=${location.lat},${location.lon}`;
    return { eventId: event.id, patientName: profile.name, patientId: profile.id,
             timestamp: event.startTime, seizureType: event.type,
             confidence: event.confidence, location: location ?? undefined, message: msg };
  }

  private createRecord(eventId: string, caregiverId: string, channel: AlertRecord['channel']): AlertRecord {
    return { alertId: `${eventId}-${caregiverId}-${Date.now()}`, eventId, caregiverId,
             channel, sentAt: Date.now(), acknowledged: false, retryCount: 0 };
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000), min = Math.floor(s / 60), sec = s % 60;
    return min > 0 ? `${min} min ${sec} s` : `${sec} segundos`;
  }
}
