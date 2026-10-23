import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { AuthSession } from '../types';

const SESSION_KEY = 'aceone_session';
const DEVICE_KEY = 'aceone_device_id';

function webStorage(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function getValue(key: string): Promise<string | null> {
  const web = webStorage();
  if (web) return web.getItem(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setValue(key: string, value: string): Promise<void> {
  const web = webStorage();
  if (web) {
    web.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteValue(key: string): Promise<void> {
  const web = webStorage();
  if (web) {
    web.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing to clear.
  }
}

export async function loadSession(): Promise<AuthSession | null> {
  const raw = await getValue(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token || !parsed?.user?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSession(session: AuthSession): Promise<void> {
  await setValue(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await deleteValue(SESSION_KEY);
}

export async function getDeviceId(): Promise<string> {
  const existing = await getValue(DEVICE_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await setValue(DEVICE_KEY, created);
  return created;
}

export function newOperationId(): string {
  return Crypto.randomUUID();
}
