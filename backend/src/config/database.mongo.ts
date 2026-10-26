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
  ObjectId,
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

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Fields that reference another document's `_id`. Values are stored as native
 * ObjectIds whenever they are valid ObjectId strings, and reads accept the
 * legacy numeric representation as well.
 */
const REFERENCE_ID_FIELDS = new Set([
  'product_id',
  'batch_id',
  'tester_id',
  'dispatcher_id',
  'raised_by',
  'admin_id',
  'client_id',
  'dispatch_order_id',
  'fixed_by',
  'user_id',
  'entity_id',
  'print_job_id',
  'created_by',
  'bag_quantity_id',
  'grade_id',
  'vendor_id',
  'shelf_location_id',
  'approved_by_id',
]);

/** True when the value can identify a document (ObjectId hex or legacy numeric). */
export function isValidId(value: unknown): boolean {
  if (value instanceof ObjectId) return true;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value !== 0;
  if (typeof value === 'string') {
    const text = value.trim();
    return OBJECT_ID_PATTERN.test(text) || /^\d+$/.test(text);
  }
  return false;
}

/** Stable map key for an id, regardless of whether it is an ObjectId or legacy number. */
export function idKey(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  return String(value);
}

function candidatesForId(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (value instanceof ObjectId) return [value];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [value, String(value)] : [value];
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [value];
    if (OBJECT_ID_PATTERN.test(text)) return [new ObjectId(text), text];
    if (/^\d+$/.test(text)) {
      const numeric = Number(text);
      return Number.isSafeInteger(numeric) ? [numeric, text] : [text];
    }
    return [text];
  }
  return [value];
}

function dedupeCandidates(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const output: unknown[] = [];
  for (const value of values) {
    const key = value instanceof ObjectId ? `objectid:${value.toHexString()}` : `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

/** Canonical storage representation for a reference field. */
function toStorageValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined || field === '_id') return value;
  if (!REFERENCE_ID_FIELDS.has(field)) return value;
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return value;
    if (OBJECT_ID_PATTERN.test(text)) return new ObjectId(text);
    if (/^\d+$/.test(text)) {
      const numeric = Number(text);
      return Number.isSafeInteger(numeric) ? numeric : text;
    }
  }
  return value;
}

function normalizeIdCondition(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof ObjectId || value instanceof Date || Array.isArray(value)) return value;
  if (typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === '$in' || key === '$nin') {
        const list = Array.isArray(inner) ? inner : [inner];
        normalized[key] = dedupeCandidates(list.flatMap(candidatesForId));
        continue;
      }
      if (key === '$eq' || key === '$ne') {
        const candidates = dedupeCandidates(candidatesForId(inner));
        const positive = key === '$eq';
        if (candidates.length === 1) {
          normalized[key] = candidates[0];
        } else {
          normalized[positive ? '$in' : '$nin'] = candidates;
        }
        continue;
      }
      normalized[key] = inner;
    }
    return normalized;
  }
  const candidates = dedupeCandidates(candidatesForId(value));
  if (candidates.length === 0) return value;
  return candidates.length === 1 ? candidates[0] : { $in: candidates };
}

/**
 * Renames the public `id` field to the stored `_id` and expands reference ids
 * so a filter matches native ObjectIds and legacy numeric documents alike.
 */
export function normalizeFilter(filter: any): any {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return filter;
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      output[key] = Array.isArray(value) ? value.map(normalizeFilter) : value;
      continue;
    }
    if (key === '$not') {
      output[key] = normalizeFilter(value);
      continue;
    }
    if (key.startsWith('$')) {
      output[key] = value;
      continue;
    }
    if (key === 'id') {
      output._id = normalizeIdCondition('_id', value);
      continue;
    }
    if (key === '_id' || REFERENCE_ID_FIELDS.has(key)) {
      output[key] = normalizeIdCondition(key, value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

/** Always fetch `_id` so every document can expose a stable `id`. */
function normalizeProjection(projection?: Document): Document | undefined {
  if (!projection) return projection;
  const entries = Object.entries(projection);
  if (entries.length === 0) return projection;
  const inclusion = entries.some(([key, value]) => key !== '_id' && value !== 0 && value !== false);
  const output: Record<string, any> = {};
  for (const [key, value] of entries) {
    if (key === '_id' && (value === 0 || value === false)) continue;
    output[key] = value;
  }
  if (inclusion) output._id = 1;
  return output;
}

function normalizePipeline(pipeline: Document[]): Document[] {
  return pipeline.map((stage) => {
    if (!stage || typeof stage !== 'object') return stage;
    const next: Record<string, any> = { ...stage };
    if (next.$match) next.$match = normalizeFilter(next.$match);
    if (Array.isArray(next.$lookup?.pipeline)) {
      next.$lookup = { ...next.$lookup, pipeline: normalizePipeline(next.$lookup.pipeline) };
    }
    if (next.$facet && typeof next.$facet === 'object') {
      next.$facet = Object.fromEntries(
        Object.entries(next.$facet).map(([key, value]) => [
          key,
          Array.isArray(value) ? normalizePipeline(value) : value,
        ])
      );
    }
    return next;
  });
}

function convertValue(value: any): any {
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map(convertValue);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const output: Record<string, any> = {};
    for (const [key, inner] of Object.entries(value)) output[key] = convertValue(inner);
    return output;
  }
  return value;
}

/** API shape: `_id` becomes a string `id`, nested ObjectIds become strings. */
function serializeDocument<T>(document: T): T {
  if (!document || typeof document !== 'object') return document;
  const output: Record<string, any> = {};
  let hasId = false;
  let idValue: any;
  for (const [key, value] of Object.entries(document as Record<string, any>)) {
    if (key === '_id') {
      hasId = true;
      idValue = convertValue(value);
      continue;
    }
    output[key] = convertValue(value);
  }
  if (hasId) output.id = idValue;
  return output as T;
}

/** Aggregation results keep `_id` but every ObjectId value becomes a string. */
function serializeAggregate<T>(row: T): T {
  return convertValue(row);
}

function prepareWriteDocument(name: string, document: Record<string, any>): Record<string, any> {
  const { id: _ignoredId, _id: _ignoredObjectId, ...rest } = document;
  const prepared: Record<string, any> = {};
  for (const [key, value] of Object.entries(rest)) {
    prepared[key] = REFERENCE_ID_FIELDS.has(key) ? toStorageValue(key, value) : value;
  }
  if (CREATED_AT_COLLECTIONS.has(name) && prepared.created_at === undefined) {
    prepared.created_at = now();
  }
  if (UPDATED_AT_COLLECTIONS.has(name) && prepared.updated_at === undefined) {
    prepared.updated_at = now();
  }
  return prepared;
}

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
      .find(normalizeFilter(filter) as Filter<T>, {
        ...options,
        projection: normalizeProjection(options.projection),
        ...this.sessionOptions(),
      })
      .toArray();
    return documents.map((document) => serializeDocument(document)) as T[];
  }

  async findOne<T extends Document = Document>(name: string, filter: Filter<T>, options: FindOptions = {}): Promise<T | null> {
    const document = await this.collection<T>(name).findOne(normalizeFilter(filter) as Filter<T>, {
      ...options,
      projection: normalizeProjection(options.projection),
      ...this.sessionOptions(),
    });
    return document ? serializeDocument(document as T) as T : null;
  }

  async aggregate<T extends Document = Document>(name: string, pipeline: Document[], options: AggregateOptions = {}): Promise<T[]> {
    const rows = await this.collection(name)
      .aggregate<T>(normalizePipeline(pipeline), { ...options, ...this.sessionOptions() })
      .toArray();
    return rows.map((row) => serializeAggregate(row)) as T[];
  }

  async count(name: string, filter: Filter<Document> = {}, options: CountDocumentsOptions = {}): Promise<number> {
    return this.collection(name).countDocuments(normalizeFilter(filter), { ...options, ...this.sessionOptions() });
  }

  /** Inserts a document with a native ObjectId and returns its hex string. */
  async insert<T extends Document = Document>(name: string, document: Record<string, any>): Promise<string> {
    const prepared = prepareWriteDocument(name, document);
    const _id = new ObjectId();
    await this.collection<T>(name).insertOne({ ...prepared, _id } as any, this.sessionOptions());
    return _id.toHexString();
  }

  async insertMany<T extends Document = Document>(name: string, documents: Record<string, any>[]): Promise<string[]> {
    if (documents.length === 0) return [];
    const ids = documents.map(() => new ObjectId());
    const prepared = documents.map((document, index) => ({
      ...prepareWriteDocument(name, document),
      _id: ids[index],
    }));
    await this.collection<T>(name).insertMany(prepared as any[], { ...this.sessionOptions(), ordered: true });
    return ids.map((_id) => _id.toHexString());
  }

  private touchUpdate(
    collectionName: string,
    update: UpdateFilter<Document> | Document[]
  ): UpdateFilter<Document> | Document[] {
    if (Array.isArray(update)) return update;
    const normalized: Record<string, any> = {};
    for (const [operator, value] of Object.entries(update as Record<string, any>)) {
      if ((operator === '$set' || operator === '$setOnInsert') && value && typeof value === 'object') {
        const fields: Record<string, any> = {};
        for (const [field, inner] of Object.entries(value as Record<string, any>)) {
          if (field === 'id' || field === '_id') continue;
          fields[field] = toStorageValue(field, inner);
        }
        normalized[operator] = fields;
      } else if (operator === '$addToSet' && value && typeof value === 'object' && !Array.isArray(value)) {
        const fields: Record<string, any> = {};
        for (const [field, inner] of Object.entries(value as Record<string, any>)) {
          fields[field] = toStorageValue(field, inner);
        }
        normalized[operator] = fields;
      } else {
        normalized[operator] = value;
      }
    }
    if (UPDATED_AT_COLLECTIONS.has(collectionName)) {
      normalized.$set = { ...(normalized.$set || {}), updated_at: now() };
    }
    return normalized as UpdateFilter<Document>;
  }

  async updateOne(
    name: string,
    filter: Filter<Document>,
    update: UpdateFilter<Document>,
    options: UpdateOptions = {}
  ) {
    return this.collection(name).updateOne(normalizeFilter(filter), this.touchUpdate(name, update), {
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
    return this.collection(name).updateMany(normalizeFilter(filter), this.touchUpdate(name, update), {
      ...options,
      ...this.sessionOptions(),
    });
  }

  async findOneAndUpdate<T extends Document = Document>(
    name: string,
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options: FindOneAndUpdateOptions = {}
  ): Promise<T | null> {
    const document = await this.collection<T>(name).findOneAndUpdate(
      normalizeFilter(filter) as Filter<T>,
      this.touchUpdate(name, update as UpdateFilter<Document> | Document[]) as UpdateFilter<T>,
      {
        ...options,
        ...this.sessionOptions(),
      }
    );
    return document ? serializeDocument(document as T) as T : null;
  }

  async deleteOne(name: string, filter: Filter<Document>, options: DeleteOptions = {}) {
    return this.collection(name).deleteOne(normalizeFilter(filter), { ...options, ...this.sessionOptions() });
  }

  async deleteMany(name: string, filter: Filter<Document>, options: DeleteOptions = {}) {
    return this.collection(name).deleteMany(normalizeFilter(filter), { ...options, ...this.sessionOptions() });
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
