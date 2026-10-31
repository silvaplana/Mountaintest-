import { registerPlugin, type PermissionState, type PluginListenerHandle } from '@capacitor/core';
import type { GpsFix, GpsSettings } from './types';

/**
 * Plugin natif maison (android/app/src/main/java/fr/assomoutain/rando/EcoLocationPlugin.kt).
 * Les plugins communautaires imposent un GPS haute précision toutes les secondes ;
 * celui-ci expose la priorité, l'intervalle, le filtre de distance et le regroupement.
 */
export interface EcoLocationPlugin {
  start(options: GpsSettings & { title: string; text: string }): Promise<void>;
  update(options: GpsSettings): Promise<void>;
  stop(): Promise<void>;
  /** Copie de secours tenue par le service natif (relue si l'appli a été tuée), vidée à la lecture. */
  drainBuffer(): Promise<{ fixes: GpsFix[] }>;
  checkPermissions(): Promise<{ location: PermissionState; notifications: PermissionState }>;
  requestPermissions(): Promise<{ location: PermissionState; notifications: PermissionState }>;
  addListener(event: 'fixes', cb: (e: { fixes: GpsFix[] }) => void): Promise<PluginListenerHandle>;
}

export const EcoLocation = registerPlugin<EcoLocationPlugin>('EcoLocation');
