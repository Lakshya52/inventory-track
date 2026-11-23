/** All backend paths (relative to EXPO_PUBLIC_API_URL, which ends with /api). */
export const API_ENDPOINTS = {
  auth: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
    tenant: '/auth/tenant',
  },
  products: {
    list: '/products/',
    search: (q: string) => `/products/search?q=${encodeURIComponent(q)}&limit=50`,
  },
  masters: {
    grades: '/masters/grades',
    bagQuantities: '/masters/bag-quantities',
    uoms: '/masters/uoms',
  },
  shelfLocations: {
    list: '/shelf-locations/',
  },
  storage: {
    list: '/storage/',
  },
  clients: {
    list: '/clients/',
  },
  batches: {
    list: '/batches/',
    groups: (params?: string) => `/batches/groups${params ? `?${params}` : ''}`,
    createGroup: '/batches/group',
    byId: (id: string | number) => `/batches/${id}`,
  },
  qc: {
    qrJobs: (params?: string) => `/qc/qr-jobs${params ? `?${params}` : ''}`,
    qrJob: (id: string | number) => `/qc/qr-jobs/${id}`,
    qrJobPrint: (id: string | number) => `/qc/qr-jobs/${id}/print`,
    qrJobReprint: (id: string | number) => `/qc/qr-jobs/${id}/reprint`,
    printResult: '/qc/qr-jobs/print-result',
    reprintRequest: (id: string | number) => `/qc/qr-jobs/${id}/reprint-request`,
  },
  dispatchOrders: {
    mine: '/dispatch-orders/mine',
    history: '/dispatch-orders/history',
    create: '/dispatch-orders/',
    availableLabels: (batchIds: string) => `/dispatch-orders/available-qr-labels?batch_ids=${batchIds}`,
    packingList: (id: string | number) => `/dispatch-orders/${id}/packing-list`,
    packingListPdf: (id: string | number) => `/dispatch-orders/${id}/packing-list.pdf`,
    recallQr: '/dispatch-orders/recall-qr',
  },
  dispatch: {
    today: '/dispatch/today',
    stats: '/dispatch/stats',
  },
  dashboard: {
    summary: '/dashboard/',
  },
  loadingSessions: {
    active: '/loading-sessions/active',
    create: '/loading-sessions/',
    byId: (id: string) => `/loading-sessions/${id}`,
    byOrder: (orderId: string | number) => `/loading-sessions/by-order/${orderId}`,
    scan: (id: string) => `/loading-sessions/${id}/scan`,
    recallQr: (id: string) => `/loading-sessions/${id}/recall-qr`,
    seal: (id: string) => `/loading-sessions/${id}/seal`,
    finalise: (id: string) => `/loading-sessions/${id}/finalise`,
  },
} as const;
