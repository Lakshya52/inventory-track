export type Role = 'admin' | 'qc' | 'dispatch';

export type AppUser = {
  role: Role;
  name: string;
  email: string;
  phone: string;
  company: string;
  initials: string;
};

export type ReportScope = 'admin' | 'qc' | 'dispatch';

export type ReportKind = 'quality' | 'dispatch';

export type ReportPeriod = 'Monthly' | 'Weekly' | 'Yearly' | 'Custom';

export type BatchActivity = {
  id: string;
  batch: string;
  markedBy: string;
  email: string;
  product: string;
  sku: string;
  quantity: number;
  date: string;
  status: 'passed' | 'failed';
};

export type DispatchOrder = {
  id: string;
  order: string;
  raisedOn: string;
  customer: string;
  items: string;
  product: string;
  driver: string;
  status: 'pending' | 'approved';
};

export type ManagedEntity = {
  id: string;
  title: string;
  subtitle: string;
  meta?: string;
};
