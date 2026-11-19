/**
 * Lightweight realtime client — one shared WebSocket connection per session.
 *
 * Pages opt-in to live updates by calling subscribe(). They get a refetch call
 * whenever the server pushes a relevant event, rather than re-deriving partial
 * state client-side. This keeps a single source of truth in the DB.
 *
 * Events: qc.decision · batch.created · batch.printed · dispatch.order-status · dispatch.loading-opened · dispatch.loading-closed · dispatch.loading-recalled · dispatch.loading-reopened
 * Connection is /api/ws?token=<access token>&division=<division id or 'all'> — same auth as REST.
 */
export type RealtimeEventType =
  | 'qc.decision'
  | 'batch.created'
  | 'batch.printed'
  | 'dispatch.order-status'
  | 'dispatch.loading-opened'
  | 'dispatch.loading-closed'
  | 'dispatch.loading-recalled'
  | 'dispatch.loading-reopened';

export type RealtimeEvent = {
  type: RealtimeEventType;
  tenant_id: string | number;
  division_id: string | number | null;
  payload: Record<string, unknown>;
  at: number;
};

type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let sessionId = 0;

function buildUrl(): string {
  const origin = new URL(window.location.href);
  const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  const adminDivisionId = localStorage.getItem('adminDivisionId') || 'all';
  const token = localStorage.getItem('token') || '';
  return `${protocol}//${origin.host}/api/ws?token=${encodeURIComponent(token)}&division=${encodeURIComponent(adminDivisionId)}`;
}

export function startRealtime(): void {
  if (typeof window === 'undefined') return;
  if (socket) return;

  const attempt = () => {
    try {
      const ws = new WebSocket(buildUrl());
      socket = ws;
      const localSession = ++sessionId;

      ws.addEventListener('open', () => {
        if (localSession !== sessionId) return;
        if (reconnectTimer) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
      });

      ws.addEventListener('message', (msg) => {
        if (localSession !== sessionId) return;
        try {
          const event = JSON.parse(String(msg.data)) as RealtimeEvent;
          for (const listener of [...listeners]) {
            try { listener(event); } catch { /* listener errors must not break others */ }
          }
        } catch {
          // Evidence-only payload; ignore it.
        }
      });

      const scheduleReconnect = () => {
        if (localSession !== sessionId) return;
        if (reconnectTimer) return;
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          socket = null;
          attempt();
        }, 2000) as unknown as number;
      };

      ws.addEventListener('close', scheduleReconnect);
      ws.addEventListener('error', scheduleReconnect);
    } catch {
      window.setTimeout(() => { socket = null; attempt(); }, 2000);
    }
  };

  attempt();
}

export function stopRealtime(): void {
  socket?.close();
  socket = null;
  if (reconnectTimer) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
  listeners.clear();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
