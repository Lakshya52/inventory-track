import { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { api } from '../services/api';
import { DashboardStats } from '../types';

function QRCodeImage({ value, size = 60 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, { width: size, margin: 1 });
    }
  }, [value, size]);
  return <canvas ref={canvasRef} className="cursor-pointer inline-block" />;
}

function QRCodeModal({ value, onClose }: { value: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, { width: 200, margin: 2 });
    }
  }, [value]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <canvas ref={canvasRef} className="mx-auto" />
        <div className="text-center mt-3 font-mono text-sm break-all">{value}</div>
        <div className="flex gap-3 mt-4 justify-center">
          <button className="bg-blue-800 text-white px-4 py-2 rounded hover:bg-blue-900" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const statusColors: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-700',
  QC_PASSED: 'bg-green-100 text-green-700',
  QC_FAILED: 'bg-red-100 text-red-700',
  DISPATCHED: 'bg-blue-100 text-blue-700',
};

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');
  const [modalQR, setModalQR] = useState<string | null>(null);

  useEffect(() => {
    api.dashboard.stats().then(setStats).catch(e => setError(e.message));
  }, []);

  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (!stats) return <div className="p-4">Loading...</div>;

  const cards = [
    { label: 'Total Products', value: stats.totalProducts },
    { label: 'Total Batches', value: stats.totalBatches },
    { label: 'Pending QC', value: stats.pendingQc },
    { label: 'QC Passed', value: stats.qcPassed },
    { label: 'QC Failed', value: stats.qcFailed },
    { label: 'Dispatched Today', value: stats.dispatchedToday },
    { label: 'Current Inventory', value: `${stats.currentInventory} units` },
    { label: 'Inventory Value', value: `₹${stats.inventoryValue.toLocaleString()}` },
  ];

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {cards.map(c => (
          <div key={c.label} className="bg-white p-4 rounded shadow">
            <div className="text-gray-500 text-sm">{c.label}</div>
            <div className="text-xl font-bold">{c.value}</div>
          </div>
        ))}
      </div>
      <h2 className="text-lg font-semibold mb-2">Recent Batches</h2>
      <div className="bg-white rounded shadow overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Product</th>
              <th className="p-2 text-left">Batch</th>
              <th className="p-2 text-left">Qty</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">QR</th>
              <th className="p-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {(stats.recentBatches || []).map(b => (
              <tr key={b.id} className="border-t">
                <td className="p-2">{b.product_name} ({b.product_sku})</td>
                <td className="p-2 font-mono text-xs">{b.batch_number}</td>
                <td className="p-2">{b.quantity}</td>
                <td className="p-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusColors[b.status] || ''}`}>{b.status}</span>
                </td>
                <td className="p-2">
                  <QRCodeImage value={b.barcode_value} size={36} />
                  <button onClick={() => setModalQR(b.barcode_value)} className="ml-1 text-blue-600 hover:underline text-[10px]">view</button>
                </td>
                <td className="p-2 text-xs">{new Date(b.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {(stats.recentBatches || []).length === 0 && <tr><td colSpan={6} className="p-2 text-gray-500">No batches yet</td></tr>}
          </tbody>
        </table>
      </div>
      <h2 className="text-lg font-semibold mb-2">Recent Activity</h2>
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Time</th>
              <th className="p-2 text-left">Action</th>
              <th className="p-2 text-left">Description</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentActivity.map((log: any) => (
              <tr key={log.id} className="border-t">
                <td className="p-2">{new Date(log.created_at).toLocaleString()}</td>
                <td className="p-2">{log.action}</td>
                <td className="p-2">{log.description || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modalQR && <QRCodeModal value={modalQR} onClose={() => setModalQR(null)} />}
    </div>
  );
}
