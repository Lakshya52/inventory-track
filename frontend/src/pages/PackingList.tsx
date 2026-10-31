import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Printer, Package, Eye, AlertTriangle, Download, FileText, CheckCircle2, Truck, X } from 'lucide-react';
import type { EntityId } from '../types';

function itemLocation(item: any): string {
  return item.location || item.location_code || item.location_description || '-';
}

function itemBarcode(item: any, packingData: any): string {
  return item.barcode || packingData.barcode || '-';
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
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState<any[]>([]);
  const [packingData, setPackingData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleViewPacking = useCallback(async (orderId: EntityId) => {
    setLoading(true);
    setError('');
    try {
      setPackingData(await api.dispatchOrders.packingList(orderId));
    } catch (err: any) {
      setError(err.message || 'Could not load packing list');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDownloadPdf = useCallback(async (order: any) => {
    setDownloadingId(String(order.id));
    setError('');
    try {
      await api.dispatchOrders.downloadPackingListPdf(order.id, `packing-list-${order.batch_number || order.id}.pdf`);
    } catch (err: any) {
      setError(err.message || 'Could not download packing list PDF');
    } finally {
      setDownloadingId(null);
    }
  }, []);

  useEffect(() => {
    const loader = user?.role === 'DISPATCH' ? api.dispatchOrders.mine() : api.dispatchOrders.all();
    loader.then(setOrders).catch((err) => setError(err.message));
  }, [user?.role]);

  useEffect(() => {
    const orderId = searchParams.get('order');
    if (orderId) void handleViewPacking(orderId);
  }, [searchParams, handleViewPacking]);

  const handlePrint = () => {
    if (!packingData) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html><html><head><title>Packing List - Order #${escapeHtml(packingData.order_id)}</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; padding: 28px; color: #1e293b; }
        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; }
        .title { font-size: 22px; font-weight: bold; color: #0f172a; }
        .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: #f8fafc; border: 1px solid #cbd5e1; padding: 14px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th { background: #f1f5f9; padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }
        td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
        .footer { margin-top: 32px; font-size: 11px; color: #94a3b8; text-align: center; }
      </style></head><body>
      <div class="header">
        <div><div class="title">PACKING LIST</div><div>Aceone Manufacturing System</div></div>
        <div style="text-align:right;"><strong>Order #${escapeHtml(packingData.order_id)}</strong><div>Date: ${new Date().toLocaleDateString()}</div></div>
      </div>
      <div class="meta">
        <div><strong>Product:</strong> ${escapeHtml(packingData.product_name || '-')}</div>
        <div><strong>Batch Number:</strong> ${escapeHtml(packingData.batch_number || '-')}</div>
        <div><strong>Client:</strong> ${escapeHtml(packingData.client_name || '-')}</div>
        <div><strong>Driver:</strong> ${escapeHtml(packingData.driver_name || '-')}</div>
        <div><strong>Driver mobile:</strong> ${escapeHtml(packingData.driver_phone || '-')}</div>
        <div><strong>Vehicle:</strong> ${escapeHtml(packingData.vehicle_number || '-')}</div>
        <div><strong>Container:</strong> ${escapeHtml(packingData.container_number || '-')}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Product</th><th>Grade</th><th>SKU</th><th>Batch</th><th>Qty</th><th>Packaging</th><th>Location</th><th>QR Barcode</th></tr></thead>
        <tbody>
          ${packingData.items.map((item: any, i: number) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(item.product_name || '-')}</td>
              <td>${escapeHtml(item.grade || packingData.grade || '-')}</td>
              <td>${escapeHtml(item.sku || '-')}</td>
              <td style="font-family:monospace;">${escapeHtml(item.batch_number || packingData.batch_number || '-')}</td>
              <td><strong>${escapeHtml(item.quantity)} bags</strong></td>
              <td>${escapeHtml([item.bag_quantity, item.bag_quantity_unit].filter(Boolean).join(' ') || '-')}</td>
              <td>${escapeHtml(itemLocation(item))}</td>
              <td style="font-family:monospace;font-size:11px;">${escapeHtml(itemBarcode(item, packingData))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="footer">Generated by Aceone Inventory &amp; Product Scanning System</div>
      <script>window.onload = function() { setTimeout(function() { window.print(); }, 500); };<\/script>
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
                      <div className="font-bold text-slate-900 text-base">{order.product_name}</div>
                      <div className="text-xs text-slate-500 font-medium mt-0.5">
                        {order.grade_name || order.product_grade || 'Standard Grade'}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        {order.batch_number}
                      </span>
                      <div className="text-xs text-slate-600 font-semibold mt-1">
                        {order.quantity} bags
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-800">{order.client_name || 'Standard Client'}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-800 text-sm">
                        {order.vehicle_number || '-'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Driver: {order.driver_name || '-'} · Cont: {order.container_number || '-'}
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
                        <button
                          onClick={() => handleDownloadPdf(order)}
                          disabled={downloadingId === String(order.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 transition-colors"
                        >
                          <Download size={14} />
                          {downloadingId === String(order.id) ? 'Downloading...' : 'PDF'}
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

      {/* 3. PACKING LIST DETAIL PANEL (When an order is selected) */}
      {packingData && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/50">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Packing List Details — Order #{packingData.order_id}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Batch: {packingData.batch_number} · Client: {packingData.client_name}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDownloadPdf({ id: packingData.order_id, batch_number: packingData.batch_number })}
                disabled={downloadingId === String(packingData.order_id)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 shadow-2xs"
              >
                <Download size={14} /> Download PDF
              </button>
              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-2xs"
              >
                <Printer size={14} /> Print Document
              </button>
            </div>
          </div>

          <div className="p-5 border-b border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm bg-white">
            <div>
              <span className="block text-xs font-bold text-slate-400 uppercase">Product</span>
              <span className="font-bold text-slate-900">{packingData.product_name || '-'}</span>
            </div>
            <div>
              <span className="block text-xs font-bold text-slate-400 uppercase">Driver / Truck</span>
              <span className="font-bold text-slate-900">{packingData.driver_name || '-'} ({packingData.vehicle_number || '-'})</span>
            </div>
            <div>
              <span className="block text-xs font-bold text-slate-400 uppercase">Container #</span>
              <span className="font-bold text-slate-900">{packingData.container_number || '-'}</span>
            </div>
            <div>
              <span className="block text-xs font-bold text-slate-400 uppercase">Seal Number</span>
              <span className="font-bold text-slate-900">{packingData.seal_number || 'Awaiting Loading'}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-xs">
                <tr>
                  <th className="px-5 py-3">#</th>
                  <th className="px-5 py-3">Product Name</th>
                  <th className="px-5 py-3">SKU</th>
                  <th className="px-5 py-3">Batch Number</th>
                  <th className="px-5 py-3">Quantity</th>
                  <th className="px-5 py-3">Storage Location</th>
                  <th className="px-5 py-3">QR Barcode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {packingData.items?.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3 font-bold text-slate-400">{idx + 1}</td>
                    <td className="px-5 py-3 font-bold text-slate-900">{item.product_name}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{item.sku}</td>
                    <td className="px-5 py-3 font-mono text-xs font-bold text-slate-800">{item.batch_number}</td>
                    <td className="px-5 py-3 font-bold text-slate-900">{item.quantity} bags</td>
                    <td className="px-5 py-3 text-xs text-slate-700">{itemLocation(item)}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{itemBarcode(item, packingData)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
