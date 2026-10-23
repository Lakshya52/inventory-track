export const colors = {
  background: '#f6f7fb',
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  textFaint: '#94a3b8',
  primary: '#4f46e5',
  primaryDark: '#4338ca',
  primarySoft: '#eef2ff',
  success: '#059669',
  successSoft: '#ecfdf5',
  warning: '#d97706',
  warningSoft: '#fffbeb',
  danger: '#e11d48',
  dangerSoft: '#fff1f2',
  info: '#0284c7',
  infoSoft: '#f0f9ff',
  purple: '#7c3aed',
  purpleSoft: '#f5f3ff',
  slate: '#475569',
  slateSoft: '#f8fafc',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const shadows = {
  card: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};

export const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  CREATED: { bg: '#f1f5f9', text: '#475569', label: 'Waiting for QC' },
  QC_PASSED: { bg: '#ecfdf5', text: '#047857', label: 'QC Passed' },
  QC_FAILED: { bg: '#fff1f2', text: '#be123c', label: 'QC Failed' },
  DISPATCH_ORDER_RAISED: { bg: '#fffbeb', text: '#b45309', label: 'Awaiting Approval' },
  DISPATCH_APPROVED: { bg: '#f0f9ff', text: '#0369a1', label: 'Approved' },
  DISPATCH_REJECTED: { bg: '#fff1f2', text: '#be123c', label: 'Rejected' },
  DISPATCHED: { bg: '#f8fafc', text: '#475569', label: 'Dispatched' },
  PENDING: { bg: '#fffbeb', text: '#b45309', label: 'Pending' },
  APPROVED: { bg: '#ecfdf5', text: '#047857', label: 'Approved' },
  REJECTED: { bg: '#fff1f2', text: '#be123c', label: 'Rejected' },
  APPLIED: { bg: '#ecfdf5', text: '#047857', label: 'Synced' },
  FAILED: { bg: '#fff1f2', text: '#be123c', label: 'Failed' },
  CONFLICT: { bg: '#fff7ed', text: '#c2410c', label: 'Conflict' },
};
