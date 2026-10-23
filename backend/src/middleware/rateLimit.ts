import { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastCleanup = Date.now();

function cleanup(now: number): void {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function defaultKey(req: Request): string {
  if (req.user) return `${req.user.role}:${req.user.userId}`;
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

/**
 * Lightweight per-instance rate limiting. In a multi-instance deployment use
 * a shared Redis counter (or an API-gateway limiter) so limits are global.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  message?: string;
}) {
  const windowMs = Math.max(1000, options.windowMs);
  const max = Math.max(1, options.max);
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    cleanup(now);
    const key = `${options.key ? options.key(req) : defaultKey(req)}:${req.method}:${req.baseUrl}${req.path}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.status(429).json({ error: options.message || 'Too many requests. Please retry shortly.' });
      return;
    }
    next();
  };
}
