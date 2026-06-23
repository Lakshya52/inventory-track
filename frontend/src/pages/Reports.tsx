import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

const statusColors: Record<string, string> = {
  CREATED: 'bg-yellow-100 text-yellow-800',
  QC_PASSED: 'bg-green-100 text-green-800',
  QC_FAILED: 'bg-red-100 text-red-800',
  DISPATCHED: 'bg-blue-100 text-blue-800',
};

export default function Reports() {
  const { user } = useAuth();
  const [batches, setBatches] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    api.batches.list().then(setBatches);
    api.activity.list(1, 100).then(res => setLogs(res.logs));
  }, []);

  const isAdmin = user?.role === 'ADMIN';
  const isQC = user?.role === 'QC';
  const isDispatch = user?.role === 'DISPATCH';

  const availableFilters: string[] = isAdmin
    ? ['ALL', 'CREATED', 'QC_PASSED', 'QC_FAILED', 'DISPATCHED']
    : isQC
      ? ['ALL', 'QC_PASSED', 'QC_FAILED']
      : ['ALL', 'DISPATCHED'];

  const allowedStatuses = isQC ? ['QC_PASSED', 'QC_FAILED'] : isDispatch ? ['DISPATCHED'] : null;

  const filtered = (allowedStatuses
    ? batches.filter(b => allowedStatuses.includes(b.status))
    : batches
  ).filter(b => filter === 'ALL' || b.status === filter);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Reports & Logs</h1>
      <h2 className="text-lg font-semibold mb-2">Batches</h2>
      <div className="mb-4 flex gap-2 flex-wrap">
        {availableFilters.map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1 rounded text-sm ${filter === s ? 'bg-blue-800 text-white' : 'bg-gray-200'}`}>
            {s === 'ALL' ? 'All' : s}
          </button>
        ))}
      </div>
      <div className="bg-white rounded shadow overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Product</th>
              <th className="p-2 text-left">Batch</th>
              <th className="p-2 text-left">Qty</th>
              <th className="p-2 text-left">Price</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr key={b.id} className="border-t">
                <td className="p-2">{b.product_name}</td>
                <td className="p-2">{b.batch_number}</td>
                <td className="p-2">{b.quantity}</td>
                <td className="p-2">{b.unit_price > 0 ? `₹${Number(b.unit_price).toLocaleString()}` : '-'}</td>
                <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[b.status] || ''}`}>{b.status}</span></td>
                <td className="p-2">{new Date(b.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-2 text-gray-500">No batches found</td></tr>}
          </tbody>
        </table>
      </div>
      <h2 className="text-lg font-semibold mb-2">Activity Log</h2>
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Time</th>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-left">Action</th>
              <th className="p-2 text-left">Description</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log: any) => (
              <tr key={log.id} className="border-t">
                <td className="p-2">{new Date(log.created_at).toLocaleString()}</td>
                <td className="p-2">{log.user_name || '-'}</td>
                <td className="p-2">{log.action}</td>
                <td className="p-2">{log.description || '-'}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={4} className="p-2 text-gray-500">No activity yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
