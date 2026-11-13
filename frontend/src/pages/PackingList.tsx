import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Printer, Package, Eye, AlertTriangle, Download, FileText, CheckCircle2, Truck, X, MapPin } from 'lucide-react';
import type { EntityId } from '../types';
import { createPackingListPdfBlob } from '../utils/packingListPdf';
import { orderNumber } from '../utils/orderNumber';
import { formatDate } from '../utils/dateFormat';

function itemLocation(item: any): string {
  return item.location || item.location_code || item.location_description || '-';
}

function itemQrIds(item: any): string[] {
  if (Array.isArray(item.qr_values) && item.qr_values.length) {
    return item.qr_values.map((value: unknown) => String(value));
  }
  if (item.qr_value) return [String(item.qr_value)];
  return [];
}

function formatQrIds(ids: string[]): string {
  const shown = ids.slice(0, 5);
  const suffix = ids.length > 5 ? ` +${ids.length - 5} more` : '';
  return `QR ID: ${shown.join(', ')}${suffix}`;
}

function itemBarcode(item: any, packingData: any): string {
  const ids = itemQrIds(item);
  if (ids.length > 0) return formatQrIds(ids);
  return item.barcode || packingData.barcode || '-';
}

function itemGradeName(item: any, packingData: any): string {
  return item.grade_name || item.grade || packingData.grade || '-';
}

function packingGradeNames(packingData: any): string {
  const names = (packingData.items || [])
    .map((item: any) => itemGradeName(item, packingData))
    .filter((name: string) => name && name !== '-');
  return [...new Set(names)].join(', ') || packingData.grade || '-';
}

function getPackingStatus(status: string | null | undefined): { label: string; bg: string } {
  if (status === 'CLOSED_DISPATCHED' || status === 'DISPATCHED') {
    return { label: 'Dispatched (Completed)', bg: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
  }
  if (status === 'CLOSED_NOT_DISPATCHED' || status === 'NOT_DISPATCHED') {
    return { label: 'Not Dispatched', bg: 'bg-rose-100 text-rose-900 border-rose-300' };
  }
  if (status === 'APPROVED' || status === 'DISPATCH_APPROVED') {
    return { label: 'Ready to Load', bg: 'bg-blue-100 text-blue-900 border-blue-300' };
  }
  return { label: status || 'Pending', bg: 'bg-slate-100 text-slate-800 border-slate-300' };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

export default function PackingList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState<any[]>([]);
  const [packingData, setPackingData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [locationLinks, setLocationLinks] = useState<Record<string, string>>({});

  const handleViewPacking = useCallback(async (orderId: EntityId) => {
    setLoading(true);
    setError('');
    setPackingData(null);
    try {
      setPackingData(await api.dispatchOrders.packingList(orderId));
    } catch (err: any) {
      setError(err.message || 'Could not load packing list');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    if (!packingData) return;
    setDownloadingId(String(packingData.order_id));
    setError('');
    try {
      const blob = createPackingListPdfBlob(packingData);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `packing-list-${packingData.batch_number || packingData.order_id}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setError(err.message || 'Could not download packing list PDF');
    } finally {
      setDownloadingId(null);
    }
  }, [packingData]);

  useEffect(() => {
    const loader = user?.role === 'DISPATCH' ? api.dispatchOrders.mine() : api.dispatchOrders.all();
    loader.then(setOrders).catch((err) => setError(err.message));
  }, [user?.role]);

  useEffect(() => {
    api.storage.list().then((warehouses: any[]) => {
      const links: Record<string, string> = {};
      for (const warehouse of warehouses) {
        for (const rack of warehouse.racks || []) {
          for (const cell of rack.cells || []) {
            if (cell.location_code) {
              links[cell.location_code] = `/storage/${encodeURIComponent(warehouse.id)}/racks/${encodeURIComponent(rack.id)}?location=${encodeURIComponent(cell.location_code)}`;
            }
          }
        }
      }
      setLocationLinks(links);
    }).catch(() => setLocationLinks({}));
  }, []);

  useEffect(() => {
    const orderId = searchParams.get('order');
    if (orderId) void handleViewPacking(orderId);
  }, [searchParams, handleViewPacking]);

  useEffect(() => {
    if (!packingData) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPackingData(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [packingData]);

  const handlePrint = () => {
    if (!packingData) return;
    const win = window.open('', '_blank');
    if (!win) {
      setError('The print window was blocked. Allow pop-ups for this site and try again.');
      return;
    }
    win.document.write(`
      <!DOCTYPE html><html><head><title>Packing List - Order #${escapeHtml(orderNumber(packingData))}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #0f172a; font-family: Arial, sans-serif; font-size: 10px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
        .title { font-size: 21px; font-weight: 700; letter-spacing: .04em; }
        .subtitle { margin-top: 4px; color: #475569; }
        .order { text-align: right; font-size: 11px; line-height: 1.6; }
        .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 16px; background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; margin-bottom: 14px; }
        .meta-item { min-width: 0; overflow-wrap: anywhere; }
        .label { display: block; margin-bottom: 3px; color: #64748b; font-size: 8px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        table { width: 100%; table-layout: fixed; border-collapse: collapse; }
        th { background: #e2e8f0; padding: 7px 6px; text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #94a3b8; }
        td { padding: 7px 6px; border-bottom: 1px solid #e2e8f0; font-size: 9px; vertical-align: top; overflow-wrap: anywhere; }
        th:nth-child(1) { width: 4%; }
        th:nth-child(2) { width: 23%; }
        th:nth-child(3) { width: 12%; }
        th:nth-child(4) { width: 15%; }
        th:nth-child(5) { width: 9%; }
        th:nth-child(6) { width: 17%; }
        th:nth-child(7) { width: 20%; }
        tbody tr { break-inside: avoid; page-break-inside: avoid; }
        .mono { font-family: monospace; }
        .footer { margin-top: 14px; padding-top: 7px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 8px; text-align: center; }
      </style></head><body>
      <div class="header">
        <div><div class="title">PACKING LIST</div><div class="subtitle">Aceone Inventory &amp; Product Scanning System</div></div>
        <div class="order"><strong>Order #${escapeHtml(orderNumber(packingData))}</strong><div>Generated: ${formatDate(new Date())}</div></div>
      </div>
      <div class="meta">
        <div class="meta-item"><span class="label">Client</span>${escapeHtml(packingData.client_name || '-')}</div>
        <div class="meta-item"><span class="label">Grade</span>${escapeHtml(packingGradeNames(packingData))}</div>
        <div class="meta-item"><span class="label">Batch Number</span>${escapeHtml(packingData.batch_number || '-')}</div>
        <div class="meta-item"><span class="label">Transporter</span>${escapeHtml(packingData.driver_name || '-')}</div>
        <div class="meta-item"><span class="label">Transporter Mobile</span>${escapeHtml(packingData.driver_phone || '-')}</div>
        <div class="meta-item"><span class="label">Vehicle</span>${escapeHtml(packingData.vehicle_number || '-')}</div>
        <div class="meta-item"><span class="label">Container / Seal</span>${escapeHtml(packingData.container_number || '-')} / ${escapeHtml(packingData.seal_number || 'Awaiting Loading')}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Grade</th><th>SKU</th><th>Batch Number</th><th>Bags to Pick</th><th>Storage Location</th><th>QR Barcode</th></tr></thead>
        <tbody>
          ${(packingData.items || []).map((item: any, i: number) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(itemGradeName(item, packingData))}</td>
              <td>${escapeHtml(item.sku || '-')}</td>
              <td class="mono">${escapeHtml(item.batch_number || packingData.batch_number || '-')}</td>
              <td><strong>${escapeHtml(item.quantity ?? '-')}</strong></td>
              <td>${escapeHtml(itemLocation(item))}</td>
              <td class="mono">${escapeHtml(itemBarcode(item, packingData))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="footer">Generated by Aceone Inventory &amp; Product Scanning System</div>
      <script>window.onload = function() { setTimeout(function() { window.print(); }, 300); };<\/script>
      </body></html>
    `);
    win.document.close();
  };

  const processedOrders = orders.filter((order) =>
    ['APPROVED', 'CLOSED_DISPATCHED', 'CLOSED_NOT_DISPATCHED', 'DISPATCHED'].includes(order.status)
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. PAGE HEADER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-teal-100 text-teal-800 flex items-center justify-center shrink-0">
            <FileText size={24} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Packaging Lists
            </h1>
            <p className="text-sm sm:text-base text-slate-500 mt-0.5">
              Shipment manifests and packing lists ready to print or download as PDF.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold bg-blue-100 text-blue-900 border border-blue-200">
            {processedOrders.length} Dispatch Orders
          </span>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl text-sm font-semibold bg-rose-50 text-rose-800 border-2 border-rose-200 flex items-center gap-3">
          <AlertTriangle size={18} className="text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. ORDERS TABLE */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden shadow-xs">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Package size={20} className="text-slate-700" />
            <h2 className="text-lg font-bold text-slate-900">Dispatch Orders &amp; Packing Lists</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b-2 border-slate-200 text-slate-600 font-bold uppercase text-xs tracking-wider">
              <tr>
                <th className="px-5 py-4">Product &amp; Grade</th>
                <th className="px-5 py-4">Batch Lot &amp; Quantity</th>
                <th className="px-5 py-4">Client Destination</th>
                <th className="px-5 py-4">Transport Info</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {processedOrders.map((order) => {
                const status = getPackingStatus(order.status);
                const isSelected = packingData && String(packingData.order_id) === String(order.id);

                return (
                  <tr
                    key={order.id}
                    className={`transition-colors ${isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50/80'}`}
                  >
                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-900 text-base">
                        {order.grade_name || order.product_grade || 'Standard Grade'}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        {order.batch_number}
                      </span>
                      <div className="text-xs text-slate-600 font-semibold mt-1">
                        {order.quantity}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-800">{order.client_name || 'Standard Client'}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {formatDate(order.created_at)}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-800 text-sm">
                        {order.vehicle_number || '-'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Transporter: {order.driver_name || '-'} · {order.driver_phone || 'No mobile'} · Cont: {order.container_number || '-'}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${status.bg}`}>
                        {status.label}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <button
                          onClick={() => handleViewPacking(order.id)}
                          disabled={loading}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-colors"
                        >
                          <Eye size={14} /> View List
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {processedOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                      <Package size={24} />
                    </div>
                    <p className="text-base font-bold text-slate-700">No dispatch orders found</p>
                    <p className="text-sm text-slate-500 mt-0.5">Packing lists appear here as soon as a dispatch order is created.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. PACKING LIST PREVIEW */}
      {packingData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-[3px] sm:p-6"
          onClick={() => setPackingData(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="packing-list-title"
            className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <h2 id="packing-list-title" className="text-lg font-bold text-slate-900">
                  Packing List — Order #{orderNumber(packingData)}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">Batch: {packingData.batch_number || '-'} · Client: {packingData.client_name || '-'}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingId === String(packingData.order_id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-100 disabled:opacity-60"
                >
                  <Download size={14} /> {downloadingId === String(packingData.order_id) ? 'Downloading...' : 'Download PDF'}
                </button>
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-brand-700"
                >
                  <Printer size={14} /> Print List
                </button>
                <button
                  onClick={() => setPackingData(null)}
                  aria-label="Close packing list"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <X size={17} />
                </button>
              </div>
            </header>

            <div className="grid grid-cols-2 gap-3 border-b border-slate-100 bg-white p-4 text-sm sm:grid-cols-4 sm:gap-4 sm:p-5">
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">Grade</span>
                <span className="font-bold text-slate-900">{packingGradeNames(packingData)}</span>
              </div>
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">Transporter / Truck</span>
                <span className="font-bold text-slate-900">{packingData.driver_name || '-'} · {packingData.driver_phone || 'No mobile'} ({packingData.vehicle_number || '-'})</span>
              </div>
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">Container #</span>
                <span className="font-bold text-slate-900">{packingData.container_number || '-'}</span>
              </div>
              <div>
                <span className="block text-xs font-bold uppercase text-slate-400">Seal Number</span>
                <span className="font-bold text-slate-900">{packingData.seal_number || 'Awaiting Loading'}</span>
              </div>
            </div>

            <div className="min-h-0 overflow-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">#</th>
                    <th className="px-5 py-3">Grade</th>
                    <th className="px-5 py-3">SKU</th>
                    <th className="px-5 py-3">Batch Number</th>
                    <th className="px-5 py-3">Bags to Pick</th>
                    <th className="px-5 py-3">Storage Location</th>
                    <th className="px-5 py-3">QR Barcode</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {packingData.items?.map((item: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="px-5 py-3 font-bold text-slate-400">{idx + 1}</td>
                      <td className="px-5 py-3 font-bold text-slate-900">{itemGradeName(item, packingData)}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{item.sku || '-'}</td>
                      <td className="px-5 py-3 font-mono text-xs font-bold text-slate-800">{item.batch_number || packingData.batch_number || '-'}</td>
                      <td className="px-5 py-3 font-bold text-slate-900">{item.quantity ?? '-'}</td>
                      <td className="px-5 py-3">
                        {locationLinks[itemLocation(item)] ? <button
                          onClick={() => navigate(locationLinks[itemLocation(item)])}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-extrabold text-blue-800 hover:border-blue-300 hover:bg-blue-100"
                          title="Open this position in the warehouse rack"
                        ><MapPin size={13} />{itemLocation(item)}</button> : <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700"><MapPin size={13} />{itemLocation(item)}</span>}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{itemBarcode(item, packingData)}</td>
                    </tr>
                  ))}
                  {(!packingData.items || packingData.items.length === 0) && (
                    <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">No product lines found for this packing list.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
