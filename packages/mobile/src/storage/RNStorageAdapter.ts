// ─────────────────────────────────────────────────────────────
// @seizure-watch/mobile — storage/RNStorageAdapter.ts
// Adaptador AsyncStorage para persistir episodios en el dispositivo.
// ─────────────────────────────────────────────────────────────

import AsyncStorage            from '@react-native-async-storage/async-storage';
import type { StorageAdapter } from '@seizure-watch/core';

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
    const all = await AsyncStorage.getAllKeys();
    return all.filter(k => k.startsWith(prefix));
  }

  async clearPatient(patientId: string): Promise<void> {
    const keys = await this.listKeys(`seizure_watch:episodes:${patientId}`);
    await AsyncStorage.multiRemove(keys);
  }
}
