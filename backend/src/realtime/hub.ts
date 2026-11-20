/**
 * Lightweight realtime hub — WebSocket server mounted at /api/ws.
 *
 * Responsibilities (intentionally minimal):
 *   - Authenticate the handshake against the same signed token as REST.
 *   - Namespace clients into tenant + (optional) division rooms.
 *   - Broadcast compact lifecycle events to those rooms so open screens can refresh.
 *
 * It is NOT an RPC channel — clients never send anything back. The data that
 * moves here is "something changed, refetch"; authoritative state stays in the DB.
 * For UX continuity we broadcast visibility-relevant transitions only:
 *   - qc.decision  — a batch group was just PASSED / FAILED
 *   - batch.created — a new batch (group) was released to the shop
 *   - batch.printed — QR labels were printed / re-printed
 *   - dispatch.order-status — an order moved PENDING↔APPROVED/REJECTED/DISPATCHED
 *   - dispatch.loading-opened / dispatch.loading-closed — loading session lifecycle
 *   - dispatch.loading-recalled / dispatch.loading-reopened — post-seal recall / order reloaded
 *   - dispatch.loading-seal-updated — a seal number was recorded/corrected after finalise
 */
import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readAccessToken } from '../services/tokens';

export type RealtimeEventName =
  | 'hello'
  | 'qc.decision'
  | 'batch.created'
  | 'batch.printed'
  | 'dispatch.order-status'
  | 'dispatch.loading-opened'
  | 'dispatch.loading-closed'
  | 'dispatch.loading-recalled'
  | 'dispatch.loading-reopened'
  | 'dispatch.loading-seal-updated';

export type RealtimeEvent = {
  type: RealtimeEventName;
  tenant_id: string | number;
  division_id: string | number | null;
  payload: Record<string, unknown>;
  at: number;
};

type ClientConnection = {
  ws: WebSocket;
  tenantId: string;
  divisionId: string | null;
  role: string;
};

const clients = new Set<ClientConnection>();
let wss: WebSocketServer | null = null;

function safeSend(ws: WebSocket, msg: RealtimeEvent): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Best-effort delivery; a dropped client will reconnect and re-read state on next interaction.
  }
}

function closeClient(conn: ClientConnection): void {
  conn.ws.terminate();
  clients.delete(conn);
}

export function initRealtime(server: HttpServer): void {
  if (wss) return;
  wss = new WebSocketServer({ server, path: '/api/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token') || '';
    let decoded;
    try {
      decoded = readAccessToken(token);
    } catch {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const tenantId = String(decoded.tenantId);
    // Division scoping matches the REST switcher semantics:
    //   - ADMIN chooses a division via ?division=<id>, or 'all' for tenant-wide
    //   - everyone else gets their assigned division (null = tenant-wide / pre-divisions tenant)
    const divisionParam = (url.searchParams.get('division') || '').trim();
    let divisionId: string | null = null;
    if (decoded.role === 'ADMIN') {
      divisionId = !divisionParam || divisionParam === 'all' ? null : divisionParam;
    } else {
      divisionId = decoded.divisionId ? String(decoded.divisionId) : null;
    }

    const conn: ClientConnection = { ws, tenantId, divisionId, role: String(decoded.role || 'DISPATCH') };
    clients.add(conn);

    ws.on('message', () => {
      // Reserved for future heartbeats — ignore client payloads for now.
    });
    ws.on('close', () => closeClient(conn));
    ws.on('error', () => closeClient(conn));

    // Initial sync so the client can proceed immediately after connect.
    safeSend(ws, { type: 'hello', tenant_id: conn.tenantId, division_id: conn.divisionId, payload: { role: conn.role }, at: Date.now() });
  });

  // Heartbeat — terminate dead clients every 30s so viewers see fresh state.
  const interval = setInterval(() => {
    for (const conn of clients) {
      if (conn.ws.readyState !== conn.ws.OPEN) closeClient(conn);
    }
  }, 30_000);
  interval.unref?.();
}

export function shutdownRealtime(): void {
  if (!wss) return;
  for (const conn of [...clients]) closeClient(conn);
  wss.close();
  wss = null;
}

export function broadcast(
  event: Pick<RealtimeEvent, 'type' | 'tenant_id' | 'division_id' | 'payload'>,
): void {
  const envelope: RealtimeEvent = { ...event, at: Date.now() };
  for (const conn of clients) {
    if (conn.tenantId !== String(event.tenant_id)) continue;
    // Division-tagged events:
    //  - target division matches the connection's division → deliver
    //  - tenant-wide event (division_id = null) → deliver to everyone in tenant
    //  - connection has no division but event is tagged to one → deliver (viewer wants all divisions)
    if (event.division_id == null || conn.divisionId == null || String(conn.divisionId) === String(event.division_id)) {
      safeSend(conn.ws, envelope);
    }
  }
}

/** Convenience wrapper — fills tenant scope from the request, callers supply event type + payload. */
export function publish(req: import('express').Request | null, type: RealtimeEventName, payload: Record<string, unknown>): void {
  const tenantId = req?.user?.tenantId ?? null;
  const divisionId = req?.user?.divisionId ?? null;
  if (tenantId == null) return;
  broadcast({ type, tenant_id: tenantId, division_id: divisionId ?? null, payload });
}
