import { useMongo } from './database';
import { ensureAdminSchema as ensureMysqlSchema } from './schema.mysql';
import { ensureAdminSchema as ensureMongoSchema } from './schema.mongo';

/**
 * Idempotent startup migration for the selected database.
 * MySQL keeps the original SQL DDL; MongoDB creates its indexes.
 */
export async function ensureAdminSchema(): Promise<void> {
  if (useMongo) {
    await ensureMongoSchema();
    return;
  }
  await ensureMysqlSchema();
}
