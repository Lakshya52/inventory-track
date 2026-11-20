export type Role = 'admin' | 'qc' | 'dispatch';

export type AppUser = {
  role: Role;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  initials?: string;
};
