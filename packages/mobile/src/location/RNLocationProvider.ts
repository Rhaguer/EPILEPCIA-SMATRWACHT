// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — location/RNLocationProvider.ts
// Proveedor de coordenadas GPS para alertas de emergencia.
// ─────────────────────────────────────────────────────────────

import { PermissionsAndroid, Platform } from 'react-native';
import type { GeolocationCoords }        from '@seizure-watch/core';

export class RNLocationProvider {
  private lastKnownLocation: GeolocationCoords | null = null;
  private watchId: number | null = null;

  async startTracking(): Promise<void> {
    const granted = await this.requestPermission();
    if (!granted) { console.warn('[Location] Permiso denegado.'); return; }

    const Geo = this.getGeolocation();
    this.watchId = Geo.watchPosition(
      (pos: any) => {
        this.lastKnownLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
      },
      (err: any) => console.warn('[Location] Watch error:', err),
      { enableHighAccuracy: false, distanceFilter: 50, interval: 30_000, fastestInterval: 10_000 }
    );
  }

  stopTracking(): void {
    if (this.watchId !== null) {
      this.getGeolocation().clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  async getCurrentLocation(): Promise<GeolocationCoords | null> {
    if (this.lastKnownLocation) return this.lastKnownLocation;

    return new Promise(async (resolve) => {
      const granted = await this.requestPermission();
      if (!granted) { resolve(null); return; }

      this.getGeolocation().getCurrentPosition(
        (pos: any) => {
          const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
          this.lastKnownLocation = coords;
          resolve(coords);
        },
        () => resolve(null),
        { timeout: 5000, maximumAge: 60_000, enableHighAccuracy: false }
      );
    });
  }

  private async requestPermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Permiso de ubicación',
          message: 'SeizureWatch necesita tu ubicación para enviarla a cuidadores en emergencias.',
          buttonPositive: 'Permitir',
          buttonNegative: 'Cancelar',
        }
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true; // iOS solicita al llamar getCurrentPosition
  }

  private getGeolocation() {
    try {
      return require('@react-native-community/geolocation');
    } catch {
      return require('expo-location');
    }
  }
}
