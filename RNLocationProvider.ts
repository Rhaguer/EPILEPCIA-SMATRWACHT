// ============================================================
// RNLocationProvider.ts
// Obtiene coordenadas GPS del dispositivo React Native.
//
// Instalar:
//   npm install @react-native-community/geolocation
//   # O usar expo-location si estás en Expo
//
// Permisos Android (AndroidManifest.xml):
//   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
//
// Permisos iOS (Info.plist):
//   NSLocationWhenInUseUsageDescription → "Para enviar tu ubicación a cuidadores en emergencias"
// ============================================================

import { PermissionsAndroid, Platform } from 'react-native';

export interface Coords {
  lat: number;
  lon: number;
  accuracy?: number;
}

export class RNLocationProvider {
  private lastKnownLocation: Coords | null = null;
  private watchId: number | null = null;

  // Inicia seguimiento continuo (recomendado: iniciar al arrancar la app)
  async startTracking(): Promise<void> {
    const granted = await this.requestPermission();
    if (!granted) {
      console.warn('[RNLocationProvider] Permiso de ubicación denegado.');
      return;
    }

    const Geolocation = await this.getGeolocation();

    this.watchId = Geolocation.watchPosition(
      (pos) => {
        this.lastKnownLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
      },
      (err) => console.warn('[RNLocationProvider] Watch error:', err),
      {
        enableHighAccuracy: false,  // false = menor consumo de batería
        distanceFilter: 50,         // actualizar cada 50 metros
        interval: 30_000,           // Android: cada 30s
        fastestInterval: 10_000,
      }
    );
  }

  stopTracking(): void {
    if (this.watchId !== null) {
      this.getGeolocation().then(Geo => Geo.clearWatch(this.watchId!));
      this.watchId = null;
    }
  }

  // Obtiene la última ubicación conocida (rápido, sin esperar GPS)
  // o pide una nueva si no hay datos recientes
  async getCurrentLocation(): Promise<Coords | null> {
    if (this.lastKnownLocation) return this.lastKnownLocation;

    return new Promise(async (resolve) => {
      const granted = await this.requestPermission();
      if (!granted) { resolve(null); return; }

      const Geolocation = await this.getGeolocation();

      Geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          this.lastKnownLocation = coords;
          resolve(coords);
        },
        (err) => {
          console.warn('[RNLocationProvider] getCurrentPosition error:', err);
          resolve(null);
        },
        { timeout: 5000, maximumAge: 60_000, enableHighAccuracy: false }
      );
    });
  }

  // ─── Helpers ───────────────────────────────────────────

  private async requestPermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Permiso de ubicación',
          message: 'SeizureWatch necesita tu ubicación para enviarla a los cuidadores en caso de emergencia.',
          buttonPositive: 'Permitir',
          buttonNegative: 'Cancelar',
        }
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
    // iOS: el permiso se solicita automáticamente al llamar getCurrentPosition
    return true;
  }

  private async getGeolocation() {
    // Compatible con Expo y React Native bare
    try {
      return require('@react-native-community/geolocation');
    } catch {
      return require('expo-location');
    }
  }
}
