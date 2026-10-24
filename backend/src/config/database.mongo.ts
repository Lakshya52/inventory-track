import 'dotenv/config';
import {
  AggregateOptions,
  ClientSession,
  Collection,
  CountDocumentsOptions,
  Db,
  DeleteOptions,
  Document,
  Filter,
  FindOneAndUpdateOptions,
  FindOptions,
  MongoClient,
  UpdateFilter,
  UpdateOptions,
} from 'mongodb';

/**
 * MongoDB is the single source of truth. A connection is shared by the whole
 * Node process; in production each API instance opens its own pool.
 *
 * The database name may be supplied either in the URI
 * (mongodb://host:27017/factory_inventory) or through MONGO_DB_NAME.
 */
function databaseNameFromUri(uri: string): string | null {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/i.exec(uri);
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]).trim();
    return name || null;
  } catch {
    return null;
  }
}

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/factory_inventory';
const MONGO_DB_NAME =
  process.env.MONGO_DB_NAME ||
  process.env.MONGODB_DB ||
  databaseNameFromUri(MONGO_URI) ||
  'factory_inventory';

let client: MongoClient | null = null;
let database: Db | null = null;
let connecting: Promise<MongoClient> | null = null;
let transactionsSupported: boolean | null = null;

const CREATED_AT_COLLECTIONS = new Set([
  'admins',
  'qc_users',
  'dispatch_users',
  'products',
  'shelf_locations',
  'clients',
  'vendors',
  'batches',
  'qr_print_jobs',
  'qr_labels',
  'qc_records',
  'dispatch_orders',
  'dispatch_records',
  'fix_records',
  'packing_list_items',
  'activity_logs',
  'devices',
  'refresh_tokens',
]);

const UPDATED_AT_COLLECTIONS = new Set([
  'products',
  'shelf_locations',
  'clients',
  'vendors',
  'batches',
  'qr_print_jobs',
  'qc_records',
  'dispatch_orders',
  'dispatch_records',
  'fix_records',
  'devices',
]);

export async function getClient(): Promise<MongoClient> {
  if (client) return client;
  if (!connecting) {
    const pending = new MongoClient(MONGO_URI, {
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 20,
      serverSelectionTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS) || 10_000,
      connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS) || 10_000,
    }).connect();
    connecting = pending;
    pending
      .then((connected) => {
        client = connected;
      })
      .catch(() => {
        connecting = null;
      });
  }
  return connecting;
}

export async function getDb(): Promise<Db> {
  if (database) return database;
  const connected = await getClient();
  database = connected.db(MONGO_DB_NAME);
  return database;
}

export function now(): Date {
  return new Date();
}

/**
 * Wrapper around a database handle (optionally bound to a transaction
 * session) so every controller and service shares the same access patterns.
 */
export class DbContext {
  constructor(
    public readonly db: Db,
    public readonly session: ClientSession | null = null
  ) {}

  collection<T extends Document = Document>(name: string): Collection<T> {
    return this.db.collection<T>(name);
  }

  private sessionOptions(): { session?: ClientSession } {
    return this.session ? { session: this.session } : {};
  }

  async find<T extends Document = Document>(name: string, filter: Filter<T>, options: FindOptions = {}): Promise<T[]> {
    const documents = await this.collection<T>(name)
      .find(filter, { ...options, ...this.sessionOptions() })
      .toArray();
    return documents as T[];
  }

  findOne<T extends Document = Document>(name: string, filter: Filter<T>, options: FindOptions = {}) {
    return this.collection<T>(name).findOne(filter, { ...options, ...this.sessionOptions() });
  }

  aggregate<T extends Document = Document>(name: string, pipeline: Document[], options: AggregateOptions = {}) {
    return this.collection(name).aggregate<T>(pipeline, { ...options, ...this.sessionOptions() }).toArray();
  }

  async count(name: string, filter: Filter<Document> = {}, options: CountDocumentsOptions = {}): Promise<number> {
    return this.collection(name).countDocuments(filter, { ...options, ...this.sessionOptions() });
  }

  async nextIds(name: string, count = 1): Promise<number[]> {
    if (count <= 0) return [];
    const counter = await this.collection<{ _id: string; seq: number }>('counters').findOneAndUpdate(
      { _id: name },
      { $inc: { seq: count } },
      { upsert: true, returnDocument: 'after', ...this.sessionOptions() }
    );
    const last = Number(counter?.seq || count);
    return Array.from({ length: count }, (_, index) => last - count + index + 1);
  }

  async nextId(name: string): Promise<number> {
    const [id] = await this.nextIds(name, 1);
    return id;
  }

  async insert<T extends Document = Document>(name: string, document: Record<string, any>): Promise<number> {
    const id = document.id !== undefined && document.id !== null
      ? Number(document.id)
      : await this.nextId(name);
    const prepared: Record<string, any> = { ...document, id };
    if (CREATED_AT_COLLECTIONS.has(name) && prepared.created_at === undefined) {
      prepared.created_at = now();
    }
    if (UPDATED_AT_COLLECTIONS.has(name) && prepared.updated_at === undefined) {
      prepared.updated_at = now();
    }
    await this.collection<T>(name).insertOne({ ...prepared, _id: id as any } as any, this.sessionOptions());
    return id;
  }

  async insertMany<T extends Document = Document>(name: string, documents: Record<string, any>[]): Promise<number[]> {
    if (documents.length === 0) return [];
    const ids = await this.nextIds(name, documents.length);
    const prepared: Record<string, any>[] = documents.map((document, index) => {
      const id = document.id !== undefined && document.id !== null ? Number(document.id) : ids[index];
      const next: Record<string, any> = { ...document, id };
      if (CREATED_AT_COLLECTIONS.has(name) && next.created_at === undefined) {
        next.created_at = now();
      }
      if (UPDATED_AT_COLLECTIONS.has(name) && next.updated_at === undefined) {
        next.updated_at = now();
      }
      return { ...next, _id: id as any };
    });
    await this.collection<T>(name).insertMany(prepared as any[], { ...this.sessionOptions(), ordered: true });
    return prepared.map((document) => Number(document.id));
  }

  private touchUpdate(collectionName: string, update: UpdateFilter<Document>): UpdateFilter<Document> {
    if (!UPDATED_AT_COLLECTIONS.has(collectionName)) return update;
    const next = { ...update } as Record<string, any>;
    next.$set = { ...(next.$set || {}), updated_at: now() };
    return next as UpdateFilter<Document>;
  }

  async updateOne(
    name: string,
    filter: Filter<Document>,
    update: UpdateFilter<Document>,
    options: UpdateOptions = {}
  ) {
    return this.collection(name).updateOne(filter, this.touchUpdate(name, update), {
      ...options,
      ...this.sessionOptions(),
    });
  }

  async updateMany(
    name: string,
    filter: Filter<Document>,
    update: UpdateFilter<Document>,
    options: UpdateOptions = {}
  ) {
    return this.collection(name).updateMany(filter, this.touchUpdate(name, update), {
      ...options,
      ...this.sessionOptions(),
    });
  }

  async findOneAndUpdate<T extends Document = Document>(
    name: string,
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options: FindOneAndUpdateOptions = {}
  ) {
    return this.collection<T>(name).findOneAndUpdate(filter, this.touchUpdate(name, update as UpdateFilter<Document>) as UpdateFilter<T>, {
      ...options,
      ...this.sessionOptions(),
    });
  }

  async deleteOne(name: string, filter: Filter<Document>, options: DeleteOptions = {}) {
    return this.collection(name).deleteOne(filter, { ...options, ...this.sessionOptions() });
  }

  async deleteMany(name: string, filter: Filter<Document>, options: DeleteOptions = {}) {
    return this.collection(name).deleteMany(filter, { ...options, ...this.sessionOptions() });
  }
}

export async function getContext(): Promise<DbContext> {
  return new DbContext(await getDb());
}

async function supportsTransactions(connected: MongoClient): Promise<boolean> {
  if (transactionsSupported !== null) return transactionsSupported;
  try {
    const info = await connected.db().admin().command({ hello: 1 });
    transactionsSupported = Boolean(info.setName) || info.msg === 'isdbgrid';
  } catch {
    transactionsSupported = false;
  }
  return transactionsSupported;
}

/**
 * Runs a unit of work in a transaction when MongoDB supports them (replica set
 * or mongos). A standalone local MongoDB does not, so the callback still runs
 * with the same context minus the session; all sync writes are guarded by
 * conditional updates and unique indexes so retries remain safe.
 */
export async function withTransaction<T>(fn: (ctx: DbContext) => Promise<T>): Promise<T> {
  const connected = await getClient();
  const db = await getDb();
  if (!(await supportsTransactions(connected))) {
    return fn(new DbContext(db, null));
  }

  const session = connected.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(new DbContext(db, session));
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

export function stripId<T extends Record<string, any>>(document: T | null): T | null {
  if (!document) return document;
  const { _id, ...rest } = document;
  return rest as T;
}

export function stripIds<T extends Record<string, any>>(documents: T[]): T[] {
  return documents.map((document) => stripId(document) as T);
}

export function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as any).code === 11000);
}

export async function checkDatabase(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    database = null;
    connecting = null;
    transactionsSupported = null;
  }
}

/** Accepts Date, ISO strings, and YYYY-MM-DD (stored as UTC midnight). */
export function parseDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfDay(value: Date = new Date()): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function endOfDay(value: Date = new Date()): Date {
  return new Date(startOfDay(value).getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function startOfWeek(value: Date = new Date()): Date {
  const day = value.getUTCDay();
  const diff = (day + 6) % 7; // Monday-based week, matching MySQL WEEKDAY().
  return new Date(startOfDay(value).getTime() - diff * 24 * 60 * 60 * 1000);
}

export function daysAgo(days: number, from: Date = startOfDay()): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

export function ageMinutes(value: unknown): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
}

export function dayKey(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
