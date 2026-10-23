import { NextFunction, Request, Response } from 'express';
/**
 * Lightweight per-instance rate limiting. In a multi-instance deployment use
 * a shared Redis counter (or an API-gateway limiter) so limits are global.
 */
export declare function rateLimit(options: {
    windowMs: number;
    max: number;
    key?: (req: Request) => string;
    message?: string;
}): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=rateLimit.d.ts.map