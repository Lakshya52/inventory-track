import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { EntityId } from '../types';
import {
  ClipboardList, CheckCircle, XCircle, Plus, Eye, Search, Truck, FileText, AlertTriangle,
  Download, X,
} from 'lucide-react';

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function orderStatusBadge(order: any): { label: string; className: string } {
  if (order.status === 'CLOSED_DISPATCHED') return { label: 'Dispatched', className: 'badge-success' };
  if (order.status === 'CLOSED_NOT_DISPATCHED') return { label: 'Not dispatched', className: 'badge-danger' };
  if (order.status === 'PENDING') return { label: 'Pending', className: 'badge-warning' };
  if (order.status === 'APPROVED') return { label: 'Approved', className: 'badge-info' };
  if (order.status === 'REJECTED') return { label: 'Rejected', className: 'badge-danger' };
  if (order.dispatched_at) return { label: 'Dispatched', className: 'badge-success' };
  return { label: order.status || '-', className: 'badge-neutral' };
}

function canDownloadPackingList(order: any): boolean {
  return ['APPROVED', 'CLOSED_DISPATCHED', 'CLOSED_NOT_DISPATCHED'].includes(order.status)
    || Boolean(order.dispatched_at);
}

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
  const [containerNumber, setContainerNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const fetchRequest = useRef(0);

  const isAdmin = user?.role === 'ADMIN';
  const isQc = user?.role === 'QC';
  const isDispatch = user?.role === 'DISPATCH';

  const fetchData = useCallback(async () => {
    const requestId = ++fetchRequest.current;
    setLoading(true);
    try {
      if (isQc) {
        const [pending, all] = await Promise.all([
          api.dispatchOrders.pending({ q: search || undefined }),
          api.dispatchOrders.all({ q: search || undefined, status: statusFilter || undefined }),
        ]);
        if (requestId === fetchRequest.current) {
          setPendingOrders(pending);
          setOrders(all);
        }
      } else if (isDispatch) {
        const dispatchOrders = await api.dispatchOrders.mine({ q: search || undefined, status: statusFilter || undefined });
        if (requestId === fetchRequest.current) setOrders(dispatchOrders);
        const batches = await api.batches.list();
        if (requestId === fetchRequest.current) setQcPassedBatches(batches.filter((batch: any) => batch.status === 'QC_PASSED'));
      } else if (isAdmin) {
        const all = await api.dispatchOrders.all({ q: search || undefined, status: statusFilter || undefined });
        if (requestId === fetchRequest.current) {
          setOrders(all);
          setPendingOrders([]);
        }
      }
    } catch (err: any) {
      if (requestId === fetchRequest.current) {
        setMessage(err.message || 'Could not load dispatch orders');
        setMessageKind('error');
      }
    } finally {
      if (requestId === fetchRequest.current) setLoading(false);
    }
  }, [isAdmin, isDispatch, isQc, search, statusFilter]);

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

  useEffect(() => {
    if (!selectedOrder || !isQc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !actionLoading) {
        setSelectedOrder(null);
        setRemarks('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedOrder, isQc, actionLoading]);

  const showMessage = (text: string, kind: 'success' | 'error' = 'success') => {
    setMessage(text);
    setMessageKind(kind);
  };

  const handleApprove = async (id: EntityId) => {
    setActionLoading(true);
    try {
      await api.dispatchOrders.approve(id, remarks.trim() || undefined);
      showMessage('Dispatch order approved. The packing list is now available to download and dispatch can start loading.');
      setSelectedOrder(null);
      setRemarks('');
      await fetchData();
    } catch (err: any) {
      showMessage(err.message || 'Could not approve order', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: EntityId) => {
    if (!remarks.trim()) {
      showMessage('Enter QC remarks before rejecting this dispatch order.', 'error');
      return;
    }
    setActionLoading(true);
    try {
      await api.dispatchOrders.reject(id, remarks.trim());
      showMessage('Dispatch order rejected. The batch is available to dispatch again.');
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
    if (selectedBatchIds.length === 0 || !clientId || !driverName.trim() || !vehicleNumber.trim() || !containerNumber.trim()) {
      showMessage('Select batches and a client, and enter the driver, vehicle, and container details', 'error');
      return;
    }
    setActionLoading(true);
    try {
      const results = await Promise.allSettled(selectedBatchIds.map((id) => api.dispatchOrders.raise({
        batch_id: id,
        client_id: clientId,
        driver_name: driverName.trim(),
        vehicle_number: vehicleNumber.trim(),
        container_number: containerNumber.trim(),
        client_operation_id: newOperationId(),
      })));
      const succeeded = results.filter((result) => result.status === 'fulfilled').length;
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      const failed = failures.length;
      if (failed) {
        const reason = failures[0]?.reason?.message ? ` ${failures[0].reason.message}` : '';
        showMessage(`${succeeded} order${succeeded === 1 ? '' : 's'} raised; ${failed} failed.${reason} Review available batches and retry the failed ones.`, 'error');
      } else {
        showMessage(`${succeeded} dispatch order${succeeded === 1 ? '' : 's'} raised for ${clients.find(client => String(client.id) === clientId)?.name}. Waiting for QC approval.`);
      }
      setSelectedBatchIds([]);
      setClientId('');
      setDriverName('');
      setVehicleNumber('');
      setContainerNumber('');
      await fetchData();
    } catch (err: any) {
      showMessage(err.message || 'Could not raise order', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadPdf = async (order: any) => {
    setDownloadingId(String(order.id));
    setMessage('');
    try {
      await api.dispatchOrders.downloadPackingListPdf(order.id, `packing-list-${order.batch_number || order.id}.pdf`);
      showMessage(`Packing list PDF downloaded for order #${order.id}.`);
    } catch (err: any) {
      showMessage(err.message || 'Could not download packing list PDF', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const list = isQc && tab === 'pending' ? pendingOrders : orders;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispatch Orders</h1>
          <p className="page-subtitle">
            {isQc
              ? 'Approve or reject pending dispatch orders. Rejection requires QC remarks.'
              : isAdmin
                ? 'Read-only view of all dispatch orders. QC approves or rejects requests.'
                : 'Raise requests, track their QC approval, and download approved packing lists.'}
          </p>
        </div>
        {isQc && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTab('pending')} className={`btn-sm ${tab === 'pending' ? 'btn-primary' : 'btn-secondary'}`}>
              <Eye size={14} /> Pending ({pendingOrders.length})
            </button>
            <button onClick={() => setTab('all')} className={`btn-sm ${tab === 'all' ? 'btn-primary' : 'btn-secondary'}`}>
              <ClipboardList size={14} /> All Orders
            </button>
          </div>
        )}
        {isAdmin && (
          <span className="badge badge-neutral">Read-only</span>
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
          <p className="text-xs text-surface-400">Select one or more QC-passed batches. Each batch becomes an order for the same party and container; QC must approve before loading.</p>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="input-label mb-0">Select Batches * ({selectedBatchIds.length} selected)</label>
              {qcPassedBatches.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedBatchIds(qcPassedBatches.map(b => String(b.id)))}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    Select All
                  </button>
                  <span className="text-surface-300">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedBatchIds([])}
                    className="text-xs text-surface-500 hover:text-surface-700 font-medium"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {qcPassedBatches.length === 0 ? (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 p-3 rounded-xl">No QC-passed batches are currently available for dispatch.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-surface-200 divide-y divide-surface-100 bg-white">
                {qcPassedBatches.map((batch: any) => {
                  const isChecked = selectedBatchIds.includes(String(batch.id));
                  return (
                    <label
                      key={batch.id}
                      className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${
                        isChecked ? 'bg-brand-50/60' : 'hover:bg-surface-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                        checked={isChecked}
                        onChange={(e) => {
                          const idStr = String(batch.id);
                          if (e.target.checked) {
                            setSelectedBatchIds(prev => [...prev, idStr]);
                          } else {
                            setSelectedBatchIds(prev => prev.filter(id => id !== idStr));
                          }
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-surface-900">{batch.product_name}</span>
                          <span className="font-mono text-xs bg-surface-100 text-surface-700 px-1.5 py-0.5 rounded">
                            {batch.batch_number}
                          </span>
                          <span className="badge badge-success text-[10px]">{batch.grade_name || batch.product_grade || 'Standard'}</span>
                        </div>
                        <div className="text-xs text-surface-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>Qty: <strong>{batch.quantity} bags</strong> ({batch.bag_quantity_name || 'Standard size'})</span>
                          <span>Location: {batch.location_code || batch.storage_location || 'Not set'}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <label className="input-label">Client / Destination Party *</label>
            <select className="select" value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">-- Select a client --</option>
              {clients.map(client => <option key={client.id} value={client.id}>{client.name}{client.gst_number ? ` · GST: ${client.gst_number}` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="input-label">Driver Name *</label><input className="input" value={driverName} onChange={(event) => setDriverName(event.target.value)} maxLength={150} /></div>
            <div><label className="input-label">Vehicle Number *</label><input className="input" value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} maxLength={50} /></div>
            <div><label className="input-label">Container Number *</label><input className="input" value={containerNumber} onChange={(event) => setContainerNumber(event.target.value)} maxLength={100} /></div>
          </div>
          <button className="btn-primary w-full" onClick={handleRaiseOrder} disabled={!selectedBatchIds.length || !clientId || !driverName.trim() || !vehicleNumber.trim() || !containerNumber.trim() || actionLoading}>
            <ClipboardList size={16} /> {actionLoading ? 'Raising...' : 'Raise Dispatch Order'}
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <h3 className="section-title">{isQc && tab === 'pending' ? 'Pending Orders' : 'Dispatch Orders'}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input className="input pl-9 py-1.5 text-xs" placeholder="Search batch or product" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <select className="input py-1.5 text-xs w-44" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CLOSED_DISPATCHED">Dispatched</option>
              <option value="CLOSED_NOT_DISPATCHED">Not dispatched</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Product / Grade</th><th>Lot / Bags</th><th>Client / Transport</th><th>Container</th><th>Seal</th><th>Raised By</th><th>Status</th><th>Approved By</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((order) => {
                const displayStatus = orderStatusBadge(order);
                const canDownload = canDownloadPackingList(order);
                return (
                  <tr key={order.id}>
                    <td className="text-xs text-surface-400">{new Date(order.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="font-medium text-surface-800">{order.product_name}</div>
                      <div className="text-xs text-surface-400">{order.product_sku} · {order.grade_name || order.product_grade || '-'}</div>
                    </td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{order.batch_number}</span><div className="text-xs text-surface-400">{order.quantity} bags · {order.bag_quantity_name || ''}</div></td>
                    <td className="text-xs">{order.client_name || '-'}<div className="text-surface-400">{order.driver_name || '-'} / {order.vehicle_number || '-'}</div></td>
                    <td className="text-xs">{order.container_number || '-'}</td>
                    <td className="text-xs">{order.seal_number || '-'}</td>
                    <td className="text-sm">{order.raised_by_name || (isDispatch ? user?.name : '-')}</td>
                    <td>
                      <span className={`badge ${displayStatus.className}`}>{displayStatus.label}</span>
                    </td>
                    <td className="text-sm text-surface-500">{order.approver_name || order.admin_name || order.admin_remarks || '-'}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        {isQc && order.status === 'PENDING' && (
                          <button onClick={() => { setSelectedOrder(order); setRemarks(order.admin_remarks || ''); setMessage(''); }} className="btn-primary btn-xs">
                            Review
                          </button>
                        )}
                        {isDispatch && order.status === 'APPROVED' && order.batch_status !== 'LOADING' && (
                          <button
                            onClick={() => navigate(`/dispatch?order=${order.id}`)}
                            className="btn-primary btn-xs"
                          >
                            <Truck size={12} /> Dispatch
                          </button>
                        )}
                        {canDownload && (
                          <>
                            <button onClick={() => navigate(`/packing-list?order=${order.id}`)} className="btn-secondary btn-xs">
                              <FileText size={12} /> View list
                            </button>
                            <button
                              onClick={() => handleDownloadPdf(order)}
                              className="btn-secondary btn-xs"
                              disabled={downloadingId === String(order.id)}
                            >
                              <Download size={12} /> {downloadingId === String(order.id) ? 'Downloading…' : 'Download PDF'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && list.length === 0 && <tr><td colSpan={10}><div className="empty-state"><div className="empty-title">No dispatch orders match this view</div></div></td></tr>}
              {loading && <tr><td colSpan={10}><div className="empty-state"><div className="empty-title">Loading orders...</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrder && isQc && (
        <div className="modal-overlay z-50" role="presentation" onClick={() => { if (!actionLoading) { setSelectedOrder(null); setRemarks(''); } }}>
          <section className="modal-content max-w-xl" role="dialog" aria-modal="true" aria-labelledby="dispatch-review-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h2 id="dispatch-review-title" className="text-base font-semibold text-surface-900">Review dispatch request</h2><span className="badge badge-warning">PENDING</span></div>
                <p className="mt-1 text-xs text-surface-500">Order #{selectedOrder.id} · {selectedOrder.product_name || 'Product'}</p>
              </div>
              <button className="btn-ghost btn-sm" aria-label="Close review" disabled={actionLoading} onClick={() => { setSelectedOrder(null); setRemarks(''); }}><X size={16} /></button>
            </div>
            <div className="modal-body space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-surface-100 bg-surface-50 p-4 text-sm">
                <div><span className="block text-xs text-surface-400">Batch</span><span className="font-mono font-medium">{selectedOrder.batch_number || '-'}</span></div>
                <div><span className="block text-xs text-surface-400">Client</span><span className="font-medium">{selectedOrder.client_name || '-'}</span></div>
                <div><span className="block text-xs text-surface-400">Driver / Vehicle</span><span className="font-medium">{selectedOrder.driver_name || '-'} · {selectedOrder.vehicle_number || '-'}</span></div>
                <div><span className="block text-xs text-surface-400">Container</span><span className="font-medium">{selectedOrder.container_number || '-'}</span></div>
                <div className="col-span-2"><span className="block text-xs text-surface-400">Raised by</span><span className="font-medium">{selectedOrder.raised_by_name || '-'}</span></div>
              </div>
              <div className="space-y-1.5">
                <label className="input-label" htmlFor="dispatch-qc-remarks">QC remarks <span className="font-normal text-surface-400">(required to reject)</span></label>
                <textarea id="dispatch-qc-remarks" className="input" rows={3} placeholder="Add a note for the dispatch team (optional for approval)" value={remarks} onChange={(event) => setRemarks(event.target.value)} disabled={actionLoading} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setSelectedOrder(null); setRemarks(''); }} disabled={actionLoading}>Cancel</button>
              <button onClick={() => handleReject(selectedOrder.id)} className="btn-secondary text-rose-600 hover:bg-rose-50 border-rose-200" disabled={actionLoading || !remarks.trim()}><XCircle size={16} /> Reject</button>
              <button onClick={() => handleApprove(selectedOrder.id)} className="btn-primary" disabled={actionLoading}><CheckCircle size={16} /> {actionLoading ? 'Saving…' : 'Approve order'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
