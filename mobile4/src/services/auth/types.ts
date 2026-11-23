import type { Session } from '@/types/auth';

export interface AuthCredentials {
  email: string;
  password: string;
}

/** Contract implemented by the backend-backed authentication service. */
export interface AuthService {
  signIn(credentials: AuthCredentials): Promise<Session>;
  /** Rotates an expired access token using the stored refresh token. */
  refresh(session: Session): Promise<Session>;
  restoreSession(): Promise<Session | null>;
  signOut(): Promise<void>;
}
