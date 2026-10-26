import { API_URL, REQUEST_TIMEOUT_MS } from "../config";
import { File, Paths } from "expo-file-system";
import type {
  AuthSession,
  Batch,
  CreateBatchesResponse,
  EntityId,
  MobileMasterOption,
  MobileProduct,
  MobileShelfLocation,
  MobileVendor,
  QrLabel,
  QrJobDetails,
  QrPrintJob,
  SyncPullResponse,
  SyncPushResponse,
  User,
} from "../types";

// Log resolved API URL for debugging sync issues
if (__DEV__) {
  console.log("✅ [Sync] Resolved API_URL:", API_URL);
}

export class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status = 0, body: any = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

let currentSession: AuthSession | null = null;
let refreshInFlight: Promise<AuthSession> | null = null;
let sessionUpdateHandler:
  | ((session: AuthSession) => Promise<void> | void)
  | null = null;

export function setApiSession(session: AuthSession | null): void {
  currentSession = session;
}

export function setSessionUpdateHandler(
  handler: ((session: AuthSession) => Promise<void> | void) | null,
): void {
  sessionUpdateHandler = handler;
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rawRequest(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "content-type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const body = await parseResponse(response);
    if (!response.ok) {
      const message =
        (body && typeof body === "object" && (body.error || body.message)) ||
        (typeof body === "string" && body) ||
        `Request failed (${response.status})`;
      throw new ApiError(String(message), response.status, body);
    }
    return body;
    // } catch (error) {
    //   if (error instanceof ApiError) throw error;
    //   if ((error as any)?.name === 'AbortError') {
    //     throw new ApiError('The server took too long to respond. Your work is saved offline.', 0);
    //   }
    //   throw new ApiError('Server unreachable. Your work is saved offline and will sync later.', 0);
    // } finally {
    //   clearTimeout(timer);
    // }
  } catch (error) {
    // A 401 is expected when an access token expires; request() will refresh
    // the session and retry. Avoid reporting that normal flow as a network
    // error in the device console.
    if (error instanceof ApiError) {
      if (error.status !== 401) {
        console.error("[API] Request failed:", `${API_URL}${path}`, error.message);
      }
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (
      controller.signal.aborted ||
      (error as any)?.name === "AbortError" ||
      /fetch request has been canceled/i.test(message)
    ) {
      throw new ApiError(
        "The request timed out or was canceled. Check the connection and retry.",
        0,
      );
    }

    console.error("[API] Network request failed:", `${API_URL}${path}`, error);
    throw new ApiError(
      `Network error: ${message}`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function performSessionRefresh(): Promise<AuthSession> {
  if (!currentSession?.refreshToken) {
    throw new ApiError("Session expired. Please sign in again.", 401);
  }
  const body = await rawRequest("/api/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: currentSession.refreshToken }),
  });
  const next: AuthSession = {
    ...currentSession,
    token: body.token,
    refreshToken: body.refreshToken,
    refreshExpiresAt: body.refreshExpiresAt,
    user: body.user || currentSession.user,
  };
  currentSession = next;
  if (sessionUpdateHandler) await sessionUpdateHandler(next);
  return next;
}

function refreshSession(): Promise<AuthSession> {
  // Refresh tokens are rotated by the backend. Share one refresh request when
  // several screens receive 401 at once, instead of racing to consume the
  // same refresh token.
  if (!refreshInFlight) {
    refreshInFlight = performSessionRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOnUnauthorized = true,
): Promise<T> {
  const sentToken = currentSession?.token;
  try {
    return (await rawRequest(path, options, sentToken)) as T;
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      retryOnUnauthorized &&
      currentSession?.refreshToken
    ) {
      // Another request may already have rotated the refresh token while this
      // request was in flight. Retry with that newer access token first.
      if (sentToken && currentSession.token !== sentToken) {
        return (await rawRequest(path, options, currentSession.token)) as T;
      }
      await refreshSession();
      return (await rawRequest(path, options, currentSession?.token)) as T;
    }
    throw error;
  }
}

async function requestFileBytes(path: string): Promise<Uint8Array> {
  const fetchBytes = async (token?: string | null) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetch(`${API_URL}${path}`, { headers, signal: controller.signal });
      if (!response.ok) {
        const body = await parseResponse(response);
        const message = body?.error || body?.message || 'The file could not be downloaded.';
        throw new ApiError(String(message), response.status, body);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted || (error as any)?.name === 'AbortError' || /fetch request has been canceled/i.test(message)) {
        throw new ApiError('The download timed out or was canceled. Check the connection and retry.', 0);
      }
      throw new ApiError(`Network error: ${message}`, 0);
    } finally {
      clearTimeout(timer);
    }
  };

  const sentToken = currentSession?.token;
  try {
    return await fetchBytes(sentToken);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && currentSession?.refreshToken) {
      if (sentToken && currentSession.token !== sentToken) {
        return fetchBytes(currentSession.token);
      }
      const next = await refreshSession();
      return fetchBytes(next.token);
    }
    throw error;
  }
}

function queryString(params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim()) {
      query.set(key, String(value));
    }
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export const api = {
  async login(
    email: string,
    password: string,
    deviceUuid: string,
  ): Promise<AuthSession> {
    const body = await rawRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, device_uuid: deviceUuid }),
    });
    const session: AuthSession = {
      token: body.token,
      refreshToken: body.refreshToken,
      refreshExpiresAt: body.refreshExpiresAt,
      user: body.user as User,
    };
    currentSession = session;
    return session;
  },

  async me(): Promise<User & { is_active: number }> {
    return request<User & { is_active: number }>("/api/auth/me");
  },

  async logout(): Promise<void> {
    try {
      await request("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken: currentSession?.refreshToken }),
      });
    } catch {
      // Local sign-out must work even if the network is down.
    }
  },

  async registerDevice(deviceUuid: string): Promise<void> {
    await request("/api/sync/register", {
      method: "POST",
      body: JSON.stringify({
        device_uuid: deviceUuid,
        platform: "mobile",
        app_version: "1.0.0",
      }),
    });
  },

  async push(
    deviceUuid: string,
    operations: {
      operation_id: string;
      type: string;
      payload: any;
      client_timestamp: string;
    }[],
  ): Promise<SyncPushResponse> {
    return request<SyncPushResponse>("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ device_uuid: deviceUuid, operations }),
    });
  },

  async pull(
    since: number,
    deviceUuid: string,
    limit = 500,
  ): Promise<SyncPullResponse> {
    return request<SyncPullResponse>(
      `/api/sync/pull?since=${encodeURIComponent(String(since))}&limit=${limit}&device_uuid=${encodeURIComponent(deviceUuid)}`,
    );
  },

  async uploadAttachments(uris: string[]): Promise<string[]> {
    if (uris.length === 0) return [];

    const form = new FormData();

    uris.forEach((uri, index) => {
      const name = uri.split("/").pop() || `photo-${Date.now()}-${index}.jpg`;

      const file = new File(uri);

      form.append("images", file, name);
    });

    const body = await request<{ files?: { filename: string }[] }>(
      "/api/sync/attachments",
      {
        method: "POST",
        body: form,
      },
    );

    return (body.files || []).map((file) => String(file.filename));
  },

  async listProducts(): Promise<MobileProduct[]> {
    return request<MobileProduct[]>("/api/products");
  },

  profile: {
    update: (data: { name?: string; currentPassword?: string; newPassword?: string }) =>
      request<any>("/api/profile", { method: "PUT", body: JSON.stringify(data) }),
  },

  users: {
    list: () => request<any[]>("/api/users"),
    add: (data: { name: string; email: string; password: string; role: "ADMIN" | "QC" | "DISPATCH" }) =>
      request<any>("/api/users", { method: "POST", body: JSON.stringify(data) }),
    update: (role: string, id: EntityId, data: { name: string; email: string }) =>
      request<any>(`/api/users/${encodeURIComponent(role)}/${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(data) }),
    changePassword: (role: string, id: EntityId, password: string) =>
      request<any>(`/api/users/${encodeURIComponent(role)}/${encodeURIComponent(String(id))}/password`, { method: "PUT", body: JSON.stringify({ password }) }),
    setStatus: (role: string, id: EntityId, is_active: boolean) =>
      request<any>(`/api/users/${encodeURIComponent(role)}/${encodeURIComponent(String(id))}/status`, { method: "PATCH", body: JSON.stringify({ is_active }) }),
    remove: (role: string, id: EntityId) =>
      request<any>(`/api/users/${encodeURIComponent(role)}/${encodeURIComponent(String(id))}`, { method: "DELETE" }),
  },

  clients: {
    list: () => request<any[]>("/api/clients"),
    create: (data: any) => request<any>("/api/clients", { method: "POST", body: JSON.stringify(data) }),
    update: (id: EntityId, data: any) => request<any>(`/api/clients/${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: EntityId) => request<any>(`/api/clients/${encodeURIComponent(String(id))}`, { method: "DELETE" }),
  },

  async listVendors(): Promise<MobileVendor[]> {
    return request<MobileVendor[]>("/api/vendors?status=active");
  },

  vendors: {
    list: (status = "all") => request<any[]>(`/api/vendors?status=${encodeURIComponent(status)}`),
    create: (data: any) => request<any>("/api/vendors", { method: "POST", body: JSON.stringify(data) }),
    update: (id: EntityId, data: any) => request<any>(`/api/vendors/${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(data) }),
    setStatus: (id: EntityId, is_active: boolean) => request<any>(`/api/vendors/${encodeURIComponent(String(id))}/status`, { method: "PATCH", body: JSON.stringify({ is_active }) }),
    remove: (id: EntityId) => request<any>(`/api/vendors/${encodeURIComponent(String(id))}`, { method: "DELETE" }),
  },

  async listMasterOptions(kind: "grades" | "bag-quantities"): Promise<MobileMasterOption[]> {
    return request<MobileMasterOption[]>(`/api/masters/${kind}`);
  },

  masters: {
    list: (kind: "grades" | "bag-quantities") => request<any[]>(`/api/masters/${kind}`),
    create: (kind: "grades" | "bag-quantities", data: any) => request<any>(`/api/masters/${kind}`, { method: "POST", body: JSON.stringify(data) }),
    update: (kind: "grades" | "bag-quantities", id: EntityId, data: any) => request<any>(`/api/masters/${kind}/${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(data) }),
    setStatus: (kind: "grades" | "bag-quantities", id: EntityId, is_active: boolean) => request<any>(`/api/masters/${kind}/${encodeURIComponent(String(id))}/status`, { method: "PATCH", body: JSON.stringify({ is_active }) }),
    remove: (kind: "grades" | "bag-quantities", id: EntityId) => request<any>(`/api/masters/${kind}/${encodeURIComponent(String(id))}`, { method: "DELETE" }),
  },

  async listShelfLocations(): Promise<MobileShelfLocation[]> {
    return request<MobileShelfLocation[]>("/api/shelf-locations");
  },

  shelfLocations: {
    list: () => request<any[]>("/api/shelf-locations"),
    create: (data: any) => request<any>("/api/shelf-locations", { method: "POST", body: JSON.stringify(data) }),
    update: (id: EntityId, data: any) => request<any>(`/api/shelf-locations/${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: EntityId) => request<any>(`/api/shelf-locations/${encodeURIComponent(String(id))}`, { method: "DELETE" }),
  },

  products: {
    create: (data: any) => request<any>("/api/products", { method: "POST", body: JSON.stringify(data) }),
    update: (id: EntityId, data: any) => request<any>(`/api/products/${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: EntityId) => request<any>(`/api/products/${encodeURIComponent(String(id))}`, { method: "DELETE" }),
    importExcel: async (asset: { uri: string; name: string; mimeType?: string | null }) => {
      const form = new FormData();
      form.append("file", { uri: asset.uri, name: asset.name, type: asset.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as any);
      return request<any>("/api/products/import", { method: "POST", body: form });
    },
    downloadImportSample: async (): Promise<string> => {
      const bytes = await requestFileBytes('/api/products/import/sample');
      const file = new File(Paths.cache, `sample_products_import_${Date.now()}.xlsx`);
      await file.create();
      await file.write(bytes);
      return file.uri;
    },
  },

  async listBatches(): Promise<Batch[]> {
    return request<Batch[]>("/api/batches");
  },

  batches: {
    get: (id: EntityId) => request<any>(`/api/batches/${encodeURIComponent(String(id))}`),
    update: (id: EntityId, data: any) => request<any>(`/api/batches/${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(data) }),
  },

  async createBatches(data: {
    product_id: EntityId;
    batch_number: string;
    quantity: number;
    batch_count: number;
    unit_price: number;
    manufacturing_date: string;
    expiry_date: string;
    notes?: string;
    shelf_location_id?: EntityId;
  }): Promise<CreateBatchesResponse> {
    return request<CreateBatchesResponse>("/api/batches", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async finishGoods(
    id: EntityId,
    data: {
      vendor_id: EntityId;
      grade_id: EntityId;
      bag_quantity_id: EntityId;
      shelf_location_id?: EntityId;
    },
  ): Promise<{ qr_job: QrPrintJob; labels: QrLabel[] }> {
    return request(`/api/batches/${id}/finish-goods`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async reopenFailedBatch(id: EntityId, reason: string): Promise<void> {
    await request(`/api/qc/batches/${encodeURIComponent(String(id))}/reopen`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },

  async getQrJob(id: EntityId): Promise<QrJobDetails> {
    return request<QrJobDetails>(`/api/qc/qr-jobs/${encodeURIComponent(String(id))}`);
  },

  async reprintQrLabels(id: EntityId, labelIds: EntityId[]): Promise<QrJobDetails> {
    return request<QrJobDetails>(`/api/qc/qr-jobs/${encodeURIComponent(String(id))}/reprint`, {
      method: "POST",
      body: JSON.stringify({ label_ids: labelIds }),
    });
  },

  async batchByBarcode(barcode: string): Promise<Batch> {
    return request<Batch>(
      `/api/batches/barcode/${encodeURIComponent(barcode)}`,
    );
  },

  qc: {
    stats: () => request<any>("/api/qc/stats"),
    pending: (params: { page?: number; limit?: number; q?: string } = {}) => request<any>(`/api/qc/pending${queryString(params)}`),
    records: (params: { page?: number; limit?: number; q?: string; result?: string; scope?: 'mine' | 'all' } = {}) => request<any>(`/api/qc/records${queryString(params)}`),
    qrJobs: (q?: string) => request<any>(`/api/qc/qr-jobs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    createQrJob: (product_id: EntityId, quantity: number) => request<any>("/api/qc/qr-jobs", { method: "POST", body: JSON.stringify({ product_id, quantity }) }),
  },

  dispatch: {
    submit: (data: any) => request<any>("/api/dispatch", { method: "POST", body: JSON.stringify(data) }),
    submitBulk: (data: any) => request<any>("/api/dispatch/bulk", { method: "POST", body: JSON.stringify(data) }),
    today: () => request<any[]>("/api/dispatch/today"),
    stats: () => request<any>("/api/dispatch/stats"),
    ready: (q?: string) => request<any>(`/api/dispatch/ready${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    records: (q?: string) => request<any>(`/api/dispatch/records${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    approvedOrders: () => request<any[]>("/api/dispatch/approved-orders"),
  },

  dispatchOrders: {
    raise: (data: any) => request<any>("/api/dispatch-orders", { method: "POST", body: JSON.stringify(data) }),
    pending: () => request<any[]>("/api/dispatch-orders/pending"),
    all: (status?: string) => request<any[]>(`/api/dispatch-orders/all${status ? `?status=${encodeURIComponent(status)}` : ""}`),
    mine: (status?: string) => request<any[]>(`/api/dispatch-orders/mine${status ? `?status=${encodeURIComponent(status)}` : ""}`),
    approve: (id: EntityId, remarks?: string) => request<any>(`/api/dispatch-orders/${encodeURIComponent(String(id))}/approve`, { method: "POST", body: JSON.stringify({ admin_remarks: remarks }) }),
    reject: (id: EntityId, remarks?: string) => request<any>(`/api/dispatch-orders/${encodeURIComponent(String(id))}/reject`, { method: "POST", body: JSON.stringify({ admin_remarks: remarks }) }),
    packingList: (id: EntityId) => request<any>(`/api/dispatch-orders/${encodeURIComponent(String(id))}/packing-list`),
  },

  reports: {
    summary: () => request<any>("/api/reports/summary"),
    qc: (params: Record<string, string> = {}) => request<any[]>(`/api/reports/qc${queryString(params)}`),
    dispatch: (params: Record<string, string> = {}) => request<any[]>(`/api/reports/dispatch${queryString(params)}`),
    dispatchRequests: (params: Record<string, string> = {}) => request<any[]>(`/api/reports/dispatch-requests${queryString(params)}`),
    inventory: () => request<any[]>("/api/reports/inventory"),
    batches: (params: Record<string, string> = {}) => request<any[]>(`/api/reports/batches${queryString(params)}`),
  },

  activity: () => request<any>("/api/activity?page=1&limit=100"),

  production: {
    batches: () => request<any[]>("/api/production/batches"),
    submitForQc: (barcode_value: string) => request<any>("/api/production/submit-for-qc", { method: "POST", body: JSON.stringify({ barcode_value }) }),
    fixBatch: (batch_id: EntityId, description: string) => request<any>("/api/production/fix-batch", { method: "POST", body: JSON.stringify({ batch_id, description }) }),
    fixRecords: () => request<any[]>("/api/production/fix-records"),
  },

  dashboard: {
    stats: () => request<any>("/api/dashboard"),
    admin: () => request<any>("/api/dashboard/admin"),
  },

  async health(): Promise<{ status: string; database: string }> {
    return rawRequest("/api/health");
  },
};
