import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import {
  ClipboardList, CheckCircle, XCircle, Plus, Eye, Search, Truck, FileText, AlertTriangle,
} from 'lucide-react';

export default function DispatchOrders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [tab, setTab] = useState<'pending' | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  const [qcPassedBatches, setQcPassedBatches] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [clientId, setClientId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const isAdmin = user?.role === 'ADMIN';
  const isDispatch = user?.role === 'DISPATCH';

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (isAdmin) {
        const [pending, all] = await Promise.all([
          api.dispatchOrders.pending({ q: search || undefined }),
          api.dispatchOrders.all({ q: search || undefined, status: statusFilter || undefined }),
        ]);
        setPendingOrders(pending);
        setOrders(all);
      } else if (isDispatch) {
        setOrders(await api.dispatchOrders.mine({ q: search || undefined, status: statusFilter || undefined }));
        const batches = await api.batches.list();
        setQcPassedBatches(batches.filter((batch: any) => ['QC_PASSED', 'DISPATCH_REJECTED'].includes(batch.status)));
      }
    } catch (err: any) {
      setMessage(err.message || 'Could not load dispatch orders');
      setMessageKind('error');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isDispatch, search, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchData(); }, 250);
    return () => clearTimeout(timer);
  }, [fetchData]);

  useEffect(() => {
    if (isDispatch) {
      api.clients.list().then(setClients).catch((err: Error) => {
        setMessage(err.message || 'Could not load clients');
        setMessageKind('error');
      });
    }
  }, [isDispatch]);

  const showMessage = (text: string, kind: 'success' | 'error' = 'success') => {
    setMessage(text);
    setMessageKind(kind);
  };

  const handleApprove = async (id: number) => {
    setActionLoading(true);
    try {
      await api.dispatchOrders.approve(id, remarks || undefined);
      showMessage('Dispatch order approved. The dispatcher can now confirm dispatch.');
      setSelectedOrder(null);
      setRemarks('');
      await fetchData();
    } catch (err: any) {
      showMessage(err.message || 'Could not approve order', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: number) => {
    setActionLoading(true);
    try {
      await api.dispatchOrders.reject(id, remarks || undefined);
      showMessage('Dispatch order rejected.');
      setSelectedOrder(null);
      setRemarks('');
      await fetchData();
    } catch (err: any) {
      showMessage(err.message || 'Could not reject order', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRaiseOrder = async () => {
    if (selectedBatchIds.length === 0 || !clientId || !driverName.trim() || !vehicleNumber.trim()) {
      showMessage('Select one or more batches, a client, and enter the driver and vehicle details', 'error');
      return;
    }
    setActionLoading(true);
    try {
      const results = await Promise.allSettled(selectedBatchIds.map((id) => api.dispatchOrders.raise({
        batch_id: Number(id),
        client_id: Number(clientId),
        driver_name: driverName.trim(),
        vehicle_number: vehicleNumber.trim(),
      })));
      const succeeded = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.length - succeeded;
      if (failed) {
        showMessage(`${succeeded} order${succeeded === 1 ? '' : 's'} raised; ${failed} failed. Review available batches and retry the failed ones.`, 'error');
      } else {
        showMessage(`${succeeded} dispatch order${succeeded === 1 ? '' : 's'} raised for ${clients.find(client => String(client.id) === clientId)?.name}. Waiting for admin approval.`);
      }
      setSelectedBatchIds([]);
      setClientId('');
      setDriverName('');
      setVehicleNumber('');
      await fetchData();
    } catch (err: any) {
      showMessage(err.message || 'Could not raise order', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const list = isAdmin && tab === 'pending' ? pendingOrders : orders;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispatch Orders</h1>
          <p className="page-subtitle">
            {isAdmin ? 'Review and approve or reject dispatcher requests' : 'Raise requests and track their approval status'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTab('pending')} className={`btn-sm ${tab === 'pending' ? 'btn-primary' : 'btn-secondary'}`}>
              <Eye size={14} /> Pending ({pendingOrders.length})
            </button>
            <button onClick={() => setTab('all')} className={`btn-sm ${tab === 'all' ? 'btn-primary' : 'btn-secondary'}`}>
              <ClipboardList size={14} /> All Orders
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-xl text-sm flex items-center gap-2 ${
          messageKind === 'error'
            ? 'bg-rose-50 text-rose-700 border border-rose-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {messageKind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          {message}
        </div>
      )}

      {isDispatch && (
        <div className="card p-6 mb-6 space-y-4">
          <h2 className="text-sm font-semibold text-surface-800 flex items-center gap-2"><Plus size={16} /> Raise Dispatch Order</h2>
          <p className="text-xs text-surface-400">Select one or more QC-passed batches. Pending requests reserve their batches until the admin approves or rejects them.</p>
          <label className="input-label">Batches *</label>
          <select multiple className="input min-h-32" value={selectedBatchIds} onChange={(event) => setSelectedBatchIds(Array.from(event.target.selectedOptions, option => option.value))}>
            {qcPassedBatches.map((batch: any) => (
              <option key={batch.id} value={batch.id}>
                {batch.product_name} ({batch.product_sku}) - {batch.batch_number} · {batch.quantity} pcs · {batch.location_code || batch.storage_location || 'Location not set'} [{batch.status}]
              </option>
            ))}
          </select>
          {qcPassedBatches.length === 0 && <p className="text-xs text-amber-600 bg-amber-50 p-3 rounded-xl">No QC-passed batches are available right now.</p>}
          <label className="input-label">Client *</label>
          <select className="input" value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">-- Select a client --</option>
            {clients.map(client => <option key={client.id} value={client.id}>{client.name}{client.gst_number ? ` · ${client.gst_number}` : ''}</option>)}
          </select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="input-label">Driver Name *</label><input className="input" value={driverName} onChange={(event) => setDriverName(event.target.value)} maxLength={150} /></div>
            <div><label className="input-label">Vehicle Number *</label><input className="input" value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} maxLength={50} /></div>
          </div>
          <button className="btn-primary w-full" onClick={handleRaiseOrder} disabled={!selectedBatchIds.length || !clientId || !driverName.trim() || !vehicleNumber.trim() || actionLoading}>
            <ClipboardList size={16} /> {actionLoading ? 'Raising...' : 'Raise Dispatch Order'}
          </button>
        </div>
      )}

      {selectedOrder && isAdmin && (
        <div className="card p-6 mb-6 border-l-4 border-l-amber-500 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-surface-800">Order #{selectedOrder.id} — {selectedOrder.product_name}</h3>
            <span className="badge badge-warning">PENDING</span>
          </div>
          <p className="text-xs text-surface-500">Batch: {selectedOrder.batch_number} | Raised by: {selectedOrder.raised_by_name || '-'}</p>
          <p className="text-xs text-surface-500">Client: {selectedOrder.client_name || '-'} | Driver: {selectedOrder.driver_name || '-'} | Vehicle: {selectedOrder.vehicle_number || '-'}</p>
          <textarea className="input" rows={2} placeholder="Admin remarks (optional)" value={remarks} onChange={(event) => setRemarks(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleApprove(selectedOrder.id)} className="btn-primary flex-1" disabled={actionLoading}>
              <CheckCircle size={16} /> Approve
            </button>
            <button onClick={() => handleReject(selectedOrder.id)} className="btn-secondary flex-1 text-rose-600 hover:bg-rose-50 border-rose-200" disabled={actionLoading}>
              <XCircle size={16} /> Reject
            </button>
            <button className="btn-secondary" onClick={() => { setSelectedOrder(null); setRemarks(''); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <h3 className="section-title">{isAdmin && tab === 'pending' ? 'Pending Orders' : 'Dispatch Orders'}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input className="input pl-9 py-1.5 text-xs" placeholder="Search batch or product" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <select className="input py-1.5 text-xs w-36" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Product</th><th>Batch</th><th>Client / Transport</th><th>Raised By</th><th>Status</th><th>Admin</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((order) => (
                <tr key={order.id}>
                  <td className="text-xs text-surface-400">{new Date(order.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="font-medium text-surface-800">{order.product_name}</div>
                    <div className="text-xs text-surface-400">{order.product_sku}</div>
                  </td>
                  <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{order.batch_number}</span></td>
                  <td className="text-xs">{order.client_name || '-'}<div className="text-surface-400">{order.driver_name || '-'} / {order.vehicle_number || '-'}</div></td>
                  <td className="text-sm">{order.raised_by_name || (isDispatch ? user?.name : '-')}</td>
                  <td>
                    {(() => {
                      const dispatched = Boolean(order.dispatched_at) || order.batch_status === 'DISPATCHED';
                      const displayStatus = dispatched ? 'DISPATCHED' : order.status;
                      return (
                        <span className={`badge ${
                          displayStatus === 'PENDING'
                            ? 'badge-warning'
                            : displayStatus === 'APPROVED' || displayStatus === 'DISPATCHED'
                              ? 'badge-success'
                              : 'badge-danger'
                        }`}>
                          {displayStatus === 'DISPATCHED' ? 'Dispatched' : displayStatus}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="text-sm text-surface-500">{order.admin_name || order.admin_remarks || '-'}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      {isAdmin && order.status === 'PENDING' && (
                        <button onClick={() => { setSelectedOrder(order); setRemarks(order.admin_remarks || ''); setMessage(''); }} className="btn-primary btn-xs">
                          Review
                        </button>
                      )}
                      {(order.status === 'APPROVED' || order.dispatched_at || order.batch_status === 'DISPATCHED') && order.barcode_value && (
                        <button
                          onClick={() => navigate(`/dispatch?barcode=${encodeURIComponent(order.barcode_value)}`)}
                          className={`btn-primary btn-xs ${order.dispatched_at || order.batch_status === 'DISPATCHED' ? 'opacity-50 cursor-not-allowed' : ''}`}
                          disabled={Boolean(order.dispatched_at) || order.batch_status === 'DISPATCHED'}
                        >
                          <Truck size={12} /> {order.dispatched_at || order.batch_status === 'DISPATCHED' ? 'Dispatched' : 'Dispatch'}
                        </button>
                      )}
                      {(order.status === 'APPROVED' || order.status === 'REJECTED') && (
                        <button onClick={() => navigate(`/packing-list?order=${order.id}`)} className="btn-secondary btn-xs">
                          <FileText size={12} /> Packing
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && list.length === 0 && <tr><td colSpan={8}><div className="empty-state"><div className="empty-title">No dispatch orders match this view</div></div></td></tr>}
              {loading && <tr><td colSpan={8}><div className="empty-state"><div className="empty-title">Loading orders...</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
