import {
  ClipboardCheck,
  EllipsisVertical,
  Home,
  History,
  LayoutGrid,
  Package,
  PieChart,
  ScanLine,
  Truck,
  type LucideIcon,
} from 'lucide-react-native';

import type { Role } from '@/types';

export type NavItem = {
  name: string;
  label: string;
  icon: LucideIcon;
};

export const ADMIN_TABS: NavItem[] = [
  { name: 'home', label: 'Home', icon: Home },
  { name: 'reports', label: 'Reports', icon: PieChart },
  { name: 'dispatches', label: 'Dispatches', icon: Package },
  { name: 'manage', label: 'Manage', icon: LayoutGrid },
  { name: 'settings', label: 'Settings', icon: EllipsisVertical },
];

export const QC_TABS: NavItem[] = [
  { name: 'home', label: 'Home', icon: Home },
  { name: 'batches', label: 'Batches', icon: ClipboardCheck },
  { name: 'approvals', label: 'Approvals', icon: PieChart },
  { name: 'reports', label: 'Reports', icon: PieChart },
  { name: 'settings', label: 'Settings', icon: EllipsisVertical },
];

export const DISPATCH_TABS: NavItem[] = [
  { name: 'home', label: 'Home', icon: Home },
  { name: 'orders', label: 'Orders', icon: Truck },
  { name: 'scan-check', label: 'Scan', icon: ScanLine },
  { name: 'history', label: 'History', icon: History },
  { name: 'settings', label: 'Settings', icon: EllipsisVertical },
];

export const tabsByRole: Record<Role, NavItem[]> = {
  admin: ADMIN_TABS,
  qc: QC_TABS,
  dispatch: DISPATCH_TABS,
};
