import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Printer, Package, Eye, AlertTriangle } from 'lucide-react';

function itemLocation(item: any): string {
  return item.location || item.location_code || item.location_description || '-';
}

function itemBarcode(item: any, packingData: any): string {
  return item.barcode || packingData.barcode || '-';
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
  const [error, setError] = useState('');

  const handleViewPacking = useCallback(async (orderId: number) => {
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

  useEffect(() => {
    const loader = user?.role === 'ADMIN' ? api.dispatchOrders.all() : api.dispatchOrders.mine();
    loader.then(setOrders).catch((err) => setError(err.message));
  }, [user?.role]);

  useEffect(() => {
    const orderId = Number(searchParams.get('order'));
    if (Number.isFinite(orderId) && orderId > 0) void handleViewPacking(orderId);
  }, [searchParams, handleViewPacking]);

  const handlePrint = () => {
    if (!packingData) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Packing List - Order #${packingData.order_id}</title>
      <style>
        @page { margin: 15mm; }
        body { font-family: 'Inter', Arial, sans-serif; padding: clamp(12px, 4vw, 20px); }
        h1 { font-size: 20px; margin-bottom: 4px; color: #1e293b; }
        .meta { margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 12px 20px; font-size: 12px; color: #64748b; }
        .table-wrap { max-width: 100%; overflow-x: auto; }
        table { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 12px; }
        th { background: #f8fafc; padding: 10px 12px; text-align: left; border: 1px solid #e2e8f0; font-weight: 600; color: #475569; }
        td { padding: 10px 12px; border: 1px solid #e2e8f0; color: #334155; }
        tr:nth-child(even) { background: #f8fafc; }
        .footer { margin-top: 30px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 15px; }
        button { margin-bottom: 20px; padding: 8px 20px; background: #6366f1; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; }
        button:hover { background: #4f46e5; }
        @media print { button { display: none; } .table-wrap { overflow: visible; } table { min-width: 0; } }
      </style></head><body>
      <button onclick="window.print()">Print / Save PDF</button>
      <h1>Packing List</h1>
      <div class="meta">
        <span><strong>Order ID:</strong> #${escapeHtml(packingData.order_id)}</span>
        <span><strong>Status:</strong> ${escapeHtml(packingData.status)}</span>
        <span><strong>Client:</strong> ${escapeHtml(packingData.client?.name || '-')}</span>
        <span><strong>Contact:</strong> ${escapeHtml(packingData.client?.contact_person || '-')}</span>
        <span><strong>Email:</strong> ${escapeHtml(packingData.client?.email || '-')}</span>
        <span><strong>Phone:</strong> ${escapeHtml(packingData.client?.phone || '-')}</span>
        <span><strong>Address:</strong> ${escapeHtml(packingData.client?.address || '-')}</span>
        <span><strong>GST:</strong> ${escapeHtml(packingData.client?.gst_number || '-')}</span>
        <span><strong>Driver:</strong> ${escapeHtml(packingData.driver_name || '-')}</span>
        <span><strong>Vehicle:</strong> ${escapeHtml(packingData.vehicle_number || '-')}</span>
        <span><strong>Container:</strong> ${escapeHtml(packingData.container_number || '-')}</span>
        <span><strong>Grade:</strong> ${escapeHtml(packingData.grade || '-')}</span>
        <span><strong>Batch:</strong> ${escapeHtml(packingData.batch_number || 'N/A')}</span>
        <span><strong>Generated:</strong> ${escapeHtml(new Date(packingData.generated_at).toLocaleString())}</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Loaded</th><th>#</th><th>Product</th><th>Grade</th><th>SKU</th><th>Batch</th><th>Bags</th><th>Bag Content</th><th>Location</th><th>Barcode</th></tr></thead>
        <tbody>
          ${packingData.items.map((item: any, i: number) => `
            <tr>
              <td>☐</td>
              <td>${i + 1}</td>
              <td>${escapeHtml(item.product_name || '-')}</td>
              <td>${escapeHtml(item.grade || packingData.grade || '-')}</td>
              <td>${escapeHtml(item.sku || '-')}</td>
              <td style="font-family:monospace;font-size:11px;">${escapeHtml(item.batch_number || packingData.batch_number || '-')}</td>
              <td>${escapeHtml(item.quantity)} bags</td>
              <td>${escapeHtml([item.bag_quantity, item.bag_quantity_unit].filter(Boolean).join(' ') || '-')}</td>
              <td>${escapeHtml(itemLocation(item))}</td>
              <td style="font-size:10px;font-family:monospace;">${escapeHtml(itemBarcode(item, packingData))}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="footer">Generated by Aceone Inventory System</div>
      <script>window.onload = function() { setTimeout(function() { window.print(); }, 500); };<\/script>
      </body></html>
    `);
    win.document.close();
  };

  const processedOrders = orders.filter((order) => order.status === 'APPROVED' && order.dispatched_at);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Packing List</h1>
          <p className="page-subtitle">Packing lists are available after all labeled bags for the approved order have been scanned and loading is complete.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm flex items-center gap-2 bg-rose-50 text-rose-700 border border-rose-200">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="card mb-6">
        <div className="card-header"><h3 className="section-title flex items-center gap-2"><Package size={16} className="text-brand-500" /> Loaded orders</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Product / Grade</th><th>Lot / Qty</th><th>Client</th><th>Driver / Vehicle</th><th>Container</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {processedOrders.map((order) => (
                <tr key={order.id}>
                  <td className="text-xs text-surface-400">{new Date(order.created_at).toLocaleDateString()}</td>
                  <td><span className="font-medium text-surface-800">{order.product_name}</span><div className="text-xs text-surface-400">{order.grade_name || order.product_grade || '-'}</div></td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{order.batch_number}</span><div className="text-xs text-surface-400">{order.quantity} bags · {order.bag_quantity_name || ''}</div></td>
                  <td>{order.client_name || '-'}</td>
                  <td className="text-xs">{order.driver_name || '-'} / {order.vehicle_number || '-'}</td>
                  <td>{order.container_number || '-'}</td>
                  <td><span className={`badge ${order.status === 'APPROVED' ? 'badge-success' : 'badge-danger'}`}>{order.status}</span></td>
                  <td className="text-right">
                    <button onClick={() => handleViewPacking(order.id)} disabled={loading} className="btn-primary btn-sm">
                      <Eye size={14} /> {loading ? 'Loading...' : 'View / Print'}
                    </button>
                  </td>
                </tr>
              ))}
              {processedOrders.length === 0 && <tr><td colSpan={8}><div className="empty-state"><div className="empty-title">No completed loads available</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {packingData && (
        <div className="card">
          <div className="card-header">
            <div className="flex items-center justify-between w-full flex-wrap gap-2">
              <h3 className="section-title flex items-center gap-2"><Package size={16} className="text-brand-500" /> Packing List — Order #{packingData.order_id}</h3>
              <button onClick={handlePrint} className="btn-primary btn-sm"><Printer size={14} /> Print / Save PDF</button>
            </div>
          </div>
          <div className="p-4 border-b border-surface-200 flex flex-wrap gap-4 text-xs text-surface-500">
            <span><strong>Batch:</strong> {packingData.batch_number || 'N/A'}</span>
            <span><strong>Client:</strong> {packingData.client?.name || '-'}</span>
            <span><strong>Contact:</strong> {packingData.client?.contact_person || '-'}</span>
            <span><strong>Email:</strong> {packingData.client?.email || '-'}</span>
            <span><strong>Phone:</strong> {packingData.client?.phone || '-'}</span>
            <span><strong>Address:</strong> {packingData.client?.address || '-'}</span>
            <span><strong>GST:</strong> {packingData.client?.gst_number || '-'}</span>
            <span><strong>Driver:</strong> {packingData.driver_name || '-'}</span>
            <span><strong>Vehicle:</strong> {packingData.vehicle_number || '-'}</span>
            <span><strong>Container:</strong> {packingData.container_number || '-'}</span>
            <span><strong>Grade:</strong> {packingData.grade || '-'}</span>
            <span><strong>Status:</strong> {packingData.status}</span>
            <span><strong>Generated:</strong> {new Date(packingData.generated_at).toLocaleString()}</span>
            {packingData.raised_by_name && <span><strong>Raised by:</strong> {packingData.raised_by_name}</span>}
            {packingData.admin_remarks && <span><strong>Admin remarks:</strong> {packingData.admin_remarks}</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Loaded</th><th>#</th><th>Product</th><th>Grade</th><th>SKU</th><th>Batch</th><th>Bags</th><th>Bag Content</th><th>Location</th><th>Barcode</th></tr></thead>
              <tbody>
                {packingData.items.map((item: any, i: number) => (
                  <tr key={i}>
                    <td><input type="checkbox" aria-label={`Batch ${item.batch_number || packingData.batch_number} loaded`} /></td>
                    <td className="text-sm text-surface-400">{i + 1}</td>
                    <td><span className="font-medium text-surface-800">{item.product_name || '-'}</span></td>
                    <td>{item.grade || packingData.grade || '-'}</td>
                    <td className="text-sm">{item.sku || '-'}</td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{item.batch_number || packingData.batch_number}</span></td>
                    <td className="text-sm">{item.quantity} bags</td>
                    <td className="text-sm">{[item.bag_quantity, item.bag_quantity_unit].filter(Boolean).join(' ') || '-'}</td>
                    <td className="text-sm">{itemLocation(item)}</td>
                    <td className="font-mono text-xs text-surface-500">{itemBarcode(item, packingData)}</td>
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
