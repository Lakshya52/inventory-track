import { apiRequest } from './api';

export type ReportRow = Record<string, unknown>;

export type AdminReportData = {
  summary: Record<string, number>;
  qc: ReportRow[];
  dispatch: ReportRow[];
  requests: ReportRow[];
  inventory: ReportRow[];
  batches: ReportRow[];
};

function dateQuery(range?: { from?: string; to?: string }): string {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const reportsApi = {
  loadAdminReport: async (range?: { from?: string; to?: string }): Promise<AdminReportData> => {
    const dateParams = dateQuery(range);
    const [summary, qc, dispatch, requests, inventory, batches] = await Promise.all([
      apiRequest<Record<string, number>>('/reports/summary'),
      apiRequest<ReportRow[]>(`/reports/qc${dateParams}`),
      apiRequest<ReportRow[]>(`/reports/dispatch${dateParams}`),
      apiRequest<ReportRow[]>(`/reports/dispatch-requests${dateParams}`),
      apiRequest<ReportRow[]>('/reports/inventory'),
      apiRequest<ReportRow[]>(`/reports/batches${dateParams}`),
    ]);
    return { summary, qc, dispatch, requests, inventory, batches };
  },
};
