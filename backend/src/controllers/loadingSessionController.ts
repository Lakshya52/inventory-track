/**
 * Loading sessions are MongoDB-only in this SRS (no MySQL implementation).
 * Keep the routing layer database-agnostic by re-exporting the Mongo handlers.
 */
export { active, cancel, finalise, getById, latestClosedByOrder, recallQr, recallSealed, reloadOrder, scan, start, stream } from './loadingSessionController.mongo';
