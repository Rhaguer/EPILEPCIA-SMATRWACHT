// ============================================================
// ALERT SERVICE
// Envía alertas a cuidadores cuando se detecta una crisis.
// Soporta: Push notifications, SMS (Twilio), correo electrónico.
// Incluye escalamiento automático si no hay acuse de recibo.
// ============================================================

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
  smsApiUrl?: string;       // Tu endpoint SMS (ej. Twilio proxy)
  pushApiUrl?: string;      // Tu servidor de notificaciones push
  emailApiUrl?: string;
  escalationDelayMs: number;  // Tiempo antes de alertar al siguiente cuidador
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
  [SeizureType.TONIC_CLONIC]:  'Tónico-clónica (gran mal)',
  [SeizureType.FOCAL_MOTOR]:   'Focal motora',
  [SeizureType.MYOCLONIC]:     'Mioclónica',
  [SeizureType.TONIC]:         'Tónica',
  [SeizureType.HR_ANOMALY]:    'Anomalía cardíaca (posible ausencia)',
  [SeizureType.UNKNOWN]:       'Tipo desconocido',
};

export class AlertService {
  private config: AlertServiceConfig;
  private alertHistory: AlertRecord[] = [];
  private escalationTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private getLocation: GetLocationFn;
  private pendingAcknowledgment: Set<string> = new Set();

  constructor(config: AlertServiceConfig, getLocation: GetLocationFn) {
    this.config = config;
    this.getLocation = getLocation;
  }

  // ─── API Principal ──────────────────────────────────────

  async sendSeizureAlert(
    event: SeizureEvent,
    profile: PatientProfile
  ): Promise<void> {
    const location = await this.getLocation().catch(() => null);

    const payload: AlertPayload = {
      eventId: event.id,
      patientName: profile.name,
      patientId: profile.id,
      timestamp: event.startTime,
      seizureType: event.type,
      confidence: event.confidence,
      durationMs: event.durationMs,
      location: location ?? undefined,
      message: this.buildMessage(event, profile, location),
    };

    // Ordenar cuidadores por prioridad
    const sorted = [...profile.caregivers].sort((a, b) => a.priority - b.priority);

    // Alertar al cuidador de mayor prioridad primero
    const primary = sorted[0];
    if (primary) {
      await this.alertCaregiver(primary, payload);
      this.pendingAcknowledgment.add(`${event.id}:${primary.id}`);

      // Escalamiento: si no hay acuse en N segundos, alertar al siguiente
      if (sorted.length > 1) {
        this.scheduleEscalation(sorted, 1, payload, event.id);
      }
    }
  }

  async sendSeizureEndedAlert(
    event: SeizureEvent,
    profile: PatientProfile
  ): Promise<void> {
    const duration = event.durationMs
      ? this.formatDuration(event.durationMs)
      : 'duración desconocida';

    const message =
      `✅ CRISIS FINALIZADA — ${profile.name}\n` +
      `Duración: ${duration}\n` +
      `Tipo: ${SEIZURE_TYPE_LABELS[event.type]}\n` +
      `Por favor verifique el estado del menor y contacte a su médico.`;

    const payload: AlertPayload = {
      eventId: event.id,
      patientName: profile.name,
      patientId: profile.id,
      timestamp: event.endTime ?? Date.now(),
      seizureType: event.type,
      confidence: event.confidence,
      durationMs: event.durationMs,
      message,
    };

    // Notificar a todos los cuidadores del fin del evento
    for (const caregiver of profile.caregivers) {
      await this.alertCaregiver(caregiver, payload, true);
    }

    // Cancelar timers de escalamiento para este evento
    this.cancelEscalation(event.id);
  }

  async sendSudepRiskAlert(
    event: SeizureEvent,
    profile: PatientProfile
  ): Promise<void> {
    const location = await this.getLocation().catch(() => null);

    const message =
      `🚨 ALERTA CRÍTICA — ${profile.name}\n` +
      `Frecuencia cardíaca muy baja detectada tras crisis.\n` +
      `LLAME AL 131 INMEDIATAMENTE.\n` +
      (location ? `Ubicación: https://maps.google.com/?q=${location.lat},${location.lon}` : '');

    const payload: AlertPayload = {
      eventId: `sudep-${event.id}`,
      patientName: profile.name,
      patientId: profile.id,
      timestamp: Date.now(),
      seizureType: event.type,
      confidence: 1,
      message,
      location: location ?? undefined,
    };

    // SUDEP: alertar a TODOS los cuidadores simultáneamente
    await Promise.all(
      profile.caregivers.map(c => this.alertCaregiver(c, payload))
    );
  }

  acknowledgeAlert(eventId: string, caregiverId: string): void {
    const key = `${eventId}:${caregiverId}`;
    this.pendingAcknowledgment.delete(key);

    const record = this.alertHistory.find(
      r => r.eventId === eventId && r.caregiverId === caregiverId
    );
    if (record) {
      record.acknowledged = true;
      record.acknowledgedAt = Date.now();
    }

    this.cancelEscalation(eventId);
  }

  // ─── Métodos privados ───────────────────────────────────

  private async alertCaregiver(
    caregiver: CaregiverContact,
    payload: AlertPayload,
    isEndAlert = false
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.config.pushEnabled && caregiver.notifyViaPush) {
      promises.push(this.sendPush(caregiver, payload, isEndAlert));
    }
    if (this.config.smsEnabled && caregiver.notifyViaSMS) {
      promises.push(this.sendSMS(caregiver, payload));
    }
    if (this.config.emailEnabled && caregiver.email) {
      promises.push(this.sendEmail(caregiver, payload));
    }

    await Promise.allSettled(promises);
  }

  private async sendPush(
    caregiver: CaregiverContact,
    payload: AlertPayload,
    isEndAlert: boolean
  ): Promise<void> {
    if (!this.config.pushApiUrl) return;

    const record = this.createAlertRecord(payload.eventId, caregiver.id, 'push');

    try {
      const response = await fetch(this.config.pushApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caregiverId: caregiver.id,
          title: isEndAlert
            ? `Crisis finalizada — ${payload.patientName}`
            : `⚠️ CRISIS DETECTADA — ${payload.patientName}`,
          body: payload.message,
          data: {
            eventId: payload.eventId,
            type: payload.seizureType,
            timestamp: payload.timestamp,
          },
          priority: isEndAlert ? 'normal' : 'high',
          ttl: 60,
        }),
      });

      if (response.ok) {
        this.alertHistory.push({ ...record });
      } else {
        throw new Error(`Push API responded: ${response.status}`);
      }
    } catch (error) {
      console.error('[AlertService] Push failed:', error);
      if (record.retryCount < this.config.maxRetries) {
        setTimeout(() => {
          record.retryCount++;
          this.sendPush(caregiver, payload, isEndAlert);
        }, 5_000 * (record.retryCount + 1));
      }
    }
  }

  private async sendSMS(
    caregiver: CaregiverContact,
    payload: AlertPayload
  ): Promise<void> {
    if (!this.config.smsApiUrl) return;

    const record = this.createAlertRecord(payload.eventId, caregiver.id, 'sms');

    try {
      const response = await fetch(this.config.smsApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: caregiver.phone,
          message: payload.message.substring(0, 160), // SMS limit
        }),
      });

      if (response.ok) this.alertHistory.push({ ...record });
    } catch (error) {
      console.error('[AlertService] SMS failed:', error);
    }
  }

  private async sendEmail(
    caregiver: CaregiverContact,
    payload: AlertPayload
  ): Promise<void> {
    if (!this.config.emailApiUrl || !caregiver.email) return;

    const record = this.createAlertRecord(payload.eventId, caregiver.id, 'email');

    try {
      const response = await fetch(this.config.emailApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: caregiver.email,
          subject: `[SeizureWatch] Crisis detectada — ${payload.patientName}`,
          text: payload.message,
          html: this.buildEmailHTML(payload),
        }),
      });

      if (response.ok) this.alertHistory.push({ ...record });
    } catch (error) {
      console.error('[AlertService] Email failed:', error);
    }
  }

  private scheduleEscalation(
    caregivers: CaregiverContact[],
    nextIndex: number,
    payload: AlertPayload,
    eventId: string
  ): void {
    if (nextIndex >= caregivers.length) return;

    const timerId = setTimeout(async () => {
      const key = `${eventId}:${caregivers[nextIndex - 1].id}`;
      if (this.pendingAcknowledgment.has(key)) {
        // Todavía sin acuse → escalar
        await this.alertCaregiver(caregivers[nextIndex], payload);
        this.pendingAcknowledgment.add(`${eventId}:${caregivers[nextIndex].id}`);
        this.scheduleEscalation(caregivers, nextIndex + 1, payload, eventId);
      }
    }, this.config.escalationDelayMs);

    this.escalationTimers.set(`${eventId}:${nextIndex}`, timerId);
  }

  private cancelEscalation(eventId: string): void {
    for (const [key, timer] of this.escalationTimers.entries()) {
      if (key.startsWith(eventId)) {
        clearTimeout(timer);
        this.escalationTimers.delete(key);
      }
    }
  }

  private buildMessage(
    event: SeizureEvent,
    profile: PatientProfile,
    location: GeolocationCoords | null
  ): string {
    const time = new Date(event.startTime).toLocaleTimeString('es-CL');
    const typeLabel = SEIZURE_TYPE_LABELS[event.type];
    const confidence = Math.round(event.confidence * 100);

    let msg =
      `⚠️ CRISIS DETECTADA — ${profile.name}\n` +
      `Hora: ${time}\n` +
      `Tipo: ${typeLabel}\n` +
      `Confianza del sistema: ${confidence}%\n` +
      `FC: ${event.avgHeartRate} bpm\n\n` +
      `Acuda de inmediato y active emergencias si la crisis supera 5 minutos (131).`;

    if (location) {
      msg += `\n\nUbicación: https://maps.google.com/?q=${location.lat},${location.lon}`;
    }

    return msg;
  }

  private buildEmailHTML(payload: AlertPayload): string {
    const confidence = Math.round(payload.confidence * 100);
    return `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #dc2626; color: white; padding: 16px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">⚠️ Crisis epiléptica detectada</h1>
        </div>
        <div style="padding: 24px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
          <p><strong>Paciente:</strong> ${payload.patientName}</p>
          <p><strong>Tipo:</strong> ${SEIZURE_TYPE_LABELS[payload.seizureType]}</p>
          <p><strong>Confianza del sistema:</strong> ${confidence}%</p>
          <p><strong>Hora:</strong> ${new Date(payload.timestamp).toLocaleString('es-CL')}</p>
          ${payload.location
            ? `<p><strong>Ubicación:</strong> <a href="https://maps.google.com/?q=${payload.location.lat},${payload.location.lon}">Ver en mapa</a></p>`
            : ''}
          <hr/>
          <p style="font-size: 12px; color: #6b7280;">
            Este es un mensaje automático del sistema SeizureWatch.
            Confirme siempre el estado del menor con un médico.
          </p>
        </div>
      </div>
    `;
  }

  private createAlertRecord(
    eventId: string,
    caregiverId: string,
    channel: AlertRecord['channel']
  ): AlertRecord {
    return {
      alertId: `${eventId}-${caregiverId}-${Date.now()}`,
      eventId,
      caregiverId,
      channel,
      sentAt: Date.now(),
      acknowledged: false,
      retryCount: 0,
    };
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return min > 0 ? `${min} min ${sec} s` : `${sec} segundos`;
  }

  getAlertHistory(): AlertRecord[] { return [...this.alertHistory]; }
}
