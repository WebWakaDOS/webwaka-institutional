/**
 * Local mock of @webwaka/core for vitest testing.
 * In production, the real @webwaka/core package is used.
 *
 * requirePermissions() actually reads c.get('user').permissions so RBAC
 * tests can control access by seeding permissions in the test user object.
 */

export type WebWakaRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'INSTITUTION_ADMIN' | 'STAFF' | 'VIEWER';

export interface JWTPayload {
  sub: string;
  tenantId: string;
  role: WebWakaRole;
  iat: number;
  exp: number;
}

export async function validateJWT(_token: string, _secret: string): Promise<JWTPayload | null> {
  return {
    sub: 'user-test-123',
    tenantId: 'tenant-inst-123',
    role: 'INSTITUTION_ADMIN',
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

export async function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, _secret: string): Promise<string> {
  return `mock.jwt.${payload.sub}.${payload.tenantId}`;
}

/** Role check — always passes through in test environment. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireRole(_allowedRoles: string[]) {
  return async (_c: unknown, next: () => Promise<void>) => { await next(); };
}

/**
 * Permission check — ACTUALLY reads user.permissions[] from context so that
 * tests can verify that endpoints correctly enforce fine-grained permissions.
 * Returns 403 when any required permission is absent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requirePermissions(requiredPerms: string[]) {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get?.('user') as { permissions?: string[] } | undefined;
    if (user) {
      const held: string[] = Array.isArray(user.permissions) ? user.permissions : [];
      const missing = requiredPerms.filter((p) => !held.includes(p));
      if (missing.length > 0) {
        return c.json({ error: 'Insufficient permissions', required: missing }, 403);
      }
    }
    await next();
  };
}

export function jwtAuthMiddleware() {
  return async (_c: unknown, next: () => Promise<void>) => { await next(); };
}

export function secureCORS() {
  return async (_c: unknown, next: () => Promise<void>) => { await next(); };
}

export function rateLimit(_opts: unknown) {
  return async (_c: unknown, next: () => Promise<void>) => { await next(); };
}
