import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AuthSession } from './auth-types';

const SESSION_KEY = 'klj.auth.session';

export async function saveSession(session: AuthSession): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Persisting the session is best-effort; the in-memory session still works.
  }
}

export async function loadSession(): Promise<AuthSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage errors while signing out.
  }
}
