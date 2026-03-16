// ============================================================
// RNStorageAdapter.ts
// Adaptador de almacenamiento para React Native.
// Usa @react-native-async-storage/async-storage para persistir
// el historial de episodios en el dispositivo.
//
// Instalar:
//   npm install @react-native-async-storage/async-storage
//   # iOS: pod install
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageAdapter } from '../seizure-watch/src/services/EpisodeLogger';

export class RNStorageAdapter implements StorageAdapter {
  async save(key: string, data: unknown): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  }

  async load(key: string): Promise<unknown | null> {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }

  async delete(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }

  async listKeys(prefix = ''): Promise<string[]> {
    const allKeys = await AsyncStorage.getAllKeys();
    return allKeys.filter(k => k.startsWith(prefix));
  }

  // Utilidad: limpiar todos los datos del paciente
  async clearPatient(patientId: string): Promise<void> {
    const keys = await this.listKeys(`seizure_watch:episodes:${patientId}`);
    await AsyncStorage.multiRemove(keys);
  }
}
