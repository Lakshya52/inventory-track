import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { JwtPayload, Role } from '../types';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters');
}
const key = createHash('sha256').update(secret).digest();

/** Compact authenticated-encryption token. Unlike a signed JWT, its claims are not readable by clients. */
export function issueAccessToken(user: { id: string | number; name: string; email: string }, role: Role, table: JwtPayload['table'], tenantId: string | number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload: JwtPayload & { tenantId: string | number; iat: number; exp: number } = {
    userId: user.id, role, name: user.name, email: user.email, table, tenantId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (Number(process.env.JWT_ACCESS_TOKEN_SECONDS) || 900),
  };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function readAccessToken(token: string): JwtPayload & { exp: number } {
  const [version, ivText, tagText, encryptedText, extra] = token.split('.');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText || extra !== undefined) throw new Error('Invalid token');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]);
  const payload = JSON.parse(plaintext.toString('utf8'));
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000) || !payload.tenantId || !payload.userId || !payload.role || !payload.table) throw new Error('Expired or invalid token');
  return payload;
}
