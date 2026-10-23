/**
 * Idempotent startup migration. It keeps existing installations upgradeable
 * without a destructive seed. Every statement must be safe to run repeatedly.
 */
export declare function ensureAdminSchema(): Promise<void>;
//# sourceMappingURL=schema.d.ts.map