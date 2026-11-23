import { apiAuthService } from './apiAuth';
import type { AuthService } from './types';

/** The only authentication provider. It is backed by the existing backend. */
export const authService: AuthService = apiAuthService;

export type { AuthService, AuthCredentials } from './types';
