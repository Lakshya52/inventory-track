/**
 * Central route map. Group segments such as (dispatch) are intentionally omitted:
 * they do not appear in URLs. Keeping hrefs here avoids scattering string literals.
 */
export const ROUTES = {
  login: '/login',
  root: '/',
  admin: {
    dashboard: '/admin',
  },
  qc: {
    dashboard: '/qc',
  },
  dispatch: {
    home: '/home',
    batches: '/batches',
    qrPrint: '/qr-print',
    dispatch: '/dispatch',
    loading: '/loading',
    settings: '/settings',
    createBatchSelect: '/batches/create/select',
    createBatchQuantity: '/batches/create/quantity',
    createBatchDetails: '/batches/create/details',
    createBatchPreview: '/batches/create/preview',
    batchSubmitted: '/batches/submitted',
    batchQrDetails: (batchId: string) => `/qr-print/${batchId}` as const,
    createDispatchOrder: '/dispatch/create',
    dispatchOrderDetails: (orderId: string) => `/dispatch/${orderId}` as const,
    loadingScan: '/loading/scan',
    loadingRecall: '/loading/recall',
    loadingRecallType: '/loading/recall/type',
    loadingRecallCamera: '/loading/recall/camera',
    loadingSeal: '/loading/seal',
    loadingComplete: '/loading/complete',
  },
} as const;

export const ROLE_DASHBOARD_ROUTE = {
  ADMIN: ROUTES.admin.dashboard,
  QC: ROUTES.qc.dashboard,
  DISPATCH: ROUTES.dispatch.home,
} as const;
