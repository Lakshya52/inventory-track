/**
 * Backend endpoint catalogue derived from backend/src/server.ts and src/routes.
 * Only the endpoints needed now (auth) are used; the rest are listed so future
 * service modules never need to hardcode paths in screens.
 */
export const API_ENDPOINTS = {
  auth: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
    tenant: '/auth/tenant',
  },
  users: {
    profile: '/profile/',
  },
  batches: {
    list: '/batches/',
    groups: '/batches/groups',
    createGroup: '/batches/group',
  },
  qc: {
    pending: '/qc/pending',
    records: '/qc/records',
    stats: '/qc/stats',
    decision: (groupId: string) => `/qc/batch-groups/${groupId}/decision`,
    qrJobs: '/qc/qr-jobs',
    qrJob: (jobId: string) => `/qc/qr-jobs/${jobId}`,
    qrJobPrint: (jobId: string) => `/qc/qr-jobs/${jobId}/print`,
    qrJobReprint: (jobId: string) => `/qc/qr-jobs/${jobId}/reprint`,
  },
  dispatchOrders: {
    mine: '/dispatch-orders/mine',
    history: '/dispatch-orders/history',
    create: '/dispatch-orders/',
    detailPackingList: (orderId: string) => `/dispatch-orders/${orderId}/packing-list`,
  },
  loadingSessions: {
    active: '/loading-sessions/active',
    create: '/loading-sessions/',
    byOrder: (orderId: string) => `/loading-sessions/by-order/${orderId}`,
    detail: (sessionId: string) => `/loading-sessions/${sessionId}`,
    scan: (sessionId: string) => `/loading-sessions/${sessionId}/scan`,
    seal: (sessionId: string) => `/loading-sessions/${sessionId}/seal`,
    finalise: (sessionId: string) => `/loading-sessions/${sessionId}/finalise`,
  },
  storage: {
    inventory: '/storage/inventory',
  },
  sync: {
    register: '/sync/register',
    push: '/sync/push',
    pull: '/sync/pull',
    status: '/sync/status',
  },
} as const;
