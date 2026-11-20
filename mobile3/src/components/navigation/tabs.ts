import type { Role } from '@/types';

export type TabDefinition = {
  name: string;
  title: string;
};

export const ADMIN_TABS: TabDefinition[] = [
  { name: 'home', title: 'Home' },
  { name: 'reports', title: 'Reports' },
  { name: 'dispatches', title: 'Dispatches' },
  { name: 'settings', title: 'Settings' },
];

export const QC_TABS: TabDefinition[] = [
  { name: 'home', title: 'Home' },
  { name: 'batches', title: 'Batches' },
  { name: 'scan-check', title: 'Scan' },
  { name: 'reports', title: 'Reports' },
  { name: 'settings', title: 'Settings' },
];

export const DISPATCH_TABS: TabDefinition[] = [
  { name: 'home', title: 'Home' },
  { name: 'orders', title: 'Orders' },
  { name: 'scan-check', title: 'Scan' },
  { name: 'reports', title: 'Reports' },
  { name: 'settings', title: 'Settings' },
];

export const roleTabs: Record<Role, TabDefinition[]> = {
  admin: ADMIN_TABS,
  qc: QC_TABS,
  dispatch: DISPATCH_TABS,
};
