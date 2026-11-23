import type { Session } from '@/types/auth';

/**
 * Module-level mirror of the auth session so non-React API helpers can read
 * the current token and trigger a refresh without importing React context.
 */
let current: Session | null = null;
let refreshHandler: ((session: Session) => Promise<Session | null>) | null = null;

export const sessionStore = {
  get: () => current,

  set(session: Session | null) {
    current = session;
  },

  setRefreshHandler(handler: ((session: Session) => Promise<Session | null>) | null) {
    refreshHandler = handler;
  },

  async refresh() {
    if (!current || !refreshHandler) return null;
    return refreshHandler(current);
  },
};
