import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * In Expo Go, hostUri points at the Metro dev server. Metro proxies /api and
 * /uploads to the backend (see metro.config.js), so a physical phone only
 * needs to reach the Metro port instead of the API port.
 *
 * For a standalone build set EXPO_PUBLIC_API_URL, e.g.
 * EXPO_PUBLIC_API_URL=https://inventory.example.com
 */
function resolveApiUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).expoGoConfig?.debuggerHost ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;
  if (__DEV__ && typeof hostUri === 'string' && hostUri) {
    // The Metro dev server proxies /api and /uploads to the backend (see
    // metro.config.js). Using the same reachable host/port as the JS bundle
    // keeps physical devices working even when the API port is firewalled.
    const origin = hostUri.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return `http://${origin}`;
  }
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : null;
  if (host) return `http://${host}:3001`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';
}

export const API_URL = resolveApiUrl();
export const APP_VERSION = '1.0.0';
export const REQUEST_TIMEOUT_MS = 20_000;
export const SYNC_INTERVAL_MS = 60_000;
export const MAX_SYNC_BATCH = 50;
