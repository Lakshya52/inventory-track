import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { EntityId } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  ClipboardList,
  CheckCircle,
  XCircle,
  Plus,
  Eye,
  Search,
  Truck,
  FileText,
  AlertTriangle,
  Download,
  X,
  Clock,
  CheckCircle2,
} from 'lucide-react';

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const statusBadgeStyle: Record<string, { bg: string; label: string }> = {
  PENDING: { bg: 'bg-amber-100 text-amber-900 border-amber-300', label: 'Pending QC' },
  APPROVED: { bg: 'bg-blue-100 text-blue-900 border-blue-300', label: 'Ready for Loading' },
  DISPATCH_APPROVED: { bg: 'bg-blue-100 text-blue-900 border-blue-300', label: 'Ready for Loading' },
  LOADING: { bg: 'bg-indigo-100 text-indigo-900 border-indigo-300', label: 'Loading Truck' },
  DISPATCHED: { bg: 'bg-emerald-100 text-emerald-900 border-emerald-300', label: 'Dispatched' },
  CLOSED_DISPATCHED: { bg: 'bg-emerald-100 text-emerald-900 border-emerald-300', label: 'Dispatched' },
  REJECTED: { bg: 'bg-rose-100 text-rose-900 border-rose-300', label: 'Rejected' },
  CLOSED_NOT_DISPATCHED: { bg: 'bg-slate-100 text-slate-800 border-slate-300', label: 'Not Dispatched' },
  NOT_DISPATCHED: { bg: 'bg-slate-100 text-slate-800 border-slate-300', label: 'Not Dispatched' },
};

function getOrderStatusBadge(order: any): { bg: string; label: string } {
  const status = order.status || (order.dispatched_at ? 'DISPATCHED' : 'PENDING');
  return statusBadgeStyle[status] || {
    bg: 'bg-slate-100 text-slate-700 border-slate-300',
    label: order.status || 'Unknown',
  };
}

function canDownloadPackingList(order: any): boolean {
  return ['APPROVED', 'CLOSED_DISPATCHED', 'CLOSED_NOT_DISPATCHED'].includes(order.status)
    || Boolean(order.dispatched_at);
}

export default function DispatchOrders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [tab, setTab] = useState<'pending' | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
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

  useEffect(() => {
    const requestedBatch = searchParams.get('batch');
    if (requestedBatch && qcPassedBatches.some((batch) => String(batch.id) === requestedBatch)) {
      setSelectedBatchIds((current) => current.includes(requestedBatch) ? current : [...current, requestedBatch]);
    }
  }, [searchParams, qcPassedBatches]);

  const isAdmin = user?.role === 'ADMIN';
  const isQc = user?.role === 'QC';
  const isDispatch = user?.role === 'DISPATCH';

  const fetchData = useCallback(async () => {
    const requestId = ++fetchRequest.current;
    setLoading(true);
    try {
      if (isQc) {
        const [pending, all] = await Promise.all([
          api.dispatchOrders.pending({ q: debouncedSearch || undefined }),
          api.dispatchOrders.all({ q: debouncedSearch || undefined, status: statusFilter || undefined }),
        ]);
        if (requestId === fetchRequest.current) {
          setPendingOrders(pending);
          setOrders(all);
        }
      } else if (isDispatch) {
        const dispatchOrders = await api.dispatchOrders.mine({ q: debouncedSearch || undefined, status: statusFilter || undefined });
        if (requestId === fetchRequest.current) setOrders(dispatchOrders);
        const batches = await api.batches.list();
        if (requestId === fetchRequest.current) setQcPassedBatches(batches.filter((batch: any) =>
          ['QC_PASSED', 'DISPATCH_APPROVED'].includes(batch.status) &&
          Number(batch.qr_count) === Number(batch.quantity) &&
          Number(batch.available_quantity ?? batch.quantity) > 0,
        ));
      } else if (isAdmin) {
        const all = await api.dispatchOrders.all({ q: debouncedSearch || undefined, status: statusFilter || undefined });
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
  }, [isAdmin, isDispatch, isQc, debouncedSearch, statusFilter]);

  useEffect(() => {
    void fetchData();
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
    if (!selectedOrder) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !actionLoading) {
        setSelectedOrder(null);
        setRemarks('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedOrder, actionLoading]);

  const showMessage = (text: string, kind: 'success' | 'error' = 'success') => {
    setMessage(text);
    setMessageKind(kind);
  };

  const handleApprove = async (id: EntityId) => {
    setActionLoading(true);
    try {
      await api.dispatchOrders.approve(id, remarks.trim() || undefined);
      showMessage('Dispatch order approved. The packing list is now ready and loading can begin.');
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
      showMessage('Please enter remarks explaining why this order is rejected.', 'error');
      return;
    }
    setActionLoading(true);
    try {
      await api.dispatchOrders.reject(id, remarks.trim());
      showMessage('Dispatch order rejected. The batch has been returned to stock.');
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
      showMessage('Please select at least one batch, a client, and fill in driver, vehicle, and container details.', 'error');
      return;
    }
    setActionLoading(true);
    try {
      const results = await Promise.allSettled(
        selectedBatchIds.map((id) =>
          api.dispatchOrders.raise({
            batch_id: id,
            client_id: clientId,
            driver_name: driverName.trim(),
            vehicle_number: vehicleNumber.trim(),
            container_number: containerNumber.trim(),
            client_operation_id: newOperationId(),
          })
        )
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (failed) {
        showMessage(`${succeeded} orders raised; ${failed} failed. Please review available batches and try again.`, 'error');
      } else {
        const clientName = clients.find((c) => String(c.id) === clientId)?.name || 'Client';
        showMessage(`${succeeded} dispatch order(s) raised for ${clientName}. Packaging lists are ready and loading can start.`);
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
      showMessage(`Packing list PDF downloaded for Order #${order.id}.`);
    } catch (err: any) {
      showMessage(err.message || 'Could not download packing list PDF', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const list = isQc && tab === 'pending' ? pendingOrders : orders;

  const totalCount = orders.length;
  const pendingCount = orders.filter((o) => o.status === 'PENDING').length;
  const approvedCount = orders.filter((o) => o.status === 'APPROVED' || o.status === 'DISPATCH_APPROVED').length;
  const dispatchedCount = orders.filter((o) => o.status === 'DISPATCHED' || o.status === 'CLOSED_DISPATCHED' || o.dispatched_at).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. PAGE HEADER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
            <Truck size={24} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Dispatch Orders
            </h1>
            <p className="text-sm sm:text-base text-slate-500 mt-0.5">
              {isQc
                ? 'Review and approve shipments. Approved orders can proceed to truck loading.'
                : isAdmin
                ? 'Overview of all client shipments, loading status, and packing lists.'
                : 'Create dispatch orders, open packaging lists, and start loading.'}
            </p>
          </div>
        </div>

        {isQc && (
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              onClick={() => setTab('pending')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors inline-flex items-center gap-2 ${
                tab === 'pending'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Eye size={16} /> Pending ({pendingOrders.length})
            </button>
            <button
              onClick={() => setTab('all')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors inline-flex items-center gap-2 ${
                tab === 'all'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <ClipboardList size={16} /> All Orders
            </button>
          </div>
        )}
      </div>

      {/* 2. STATS CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Orders', value: totalCount, icon: <ClipboardList size={20} />, bg: 'bg-blue-100 text-blue-700' },
          {
            label: 'Pending Approval',
            value: pendingCount,
            icon: <Clock size={20} />,
            bg: pendingCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700',
            highlight: pendingCount > 0,
          },
          { label: 'Ready for Loading', value: approvedCount, icon: <CheckCircle2 size={20} />, bg: 'bg-indigo-100 text-indigo-700' },
          { label: 'Dispatched', value: dispatchedCount, icon: <Truck size={20} />, bg: 'bg-emerald-100 text-emerald-700' },
        ].map((card) => (
          <div
            key={card.label}
            className={`bg-white rounded-2xl border-2 p-5 shadow-xs ${
              card.highlight ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'
            }`}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className={`w-9 h-9 rounded-xl ${card.bg} flex items-center justify-center`}>
                {card.icon}
              </div>
              <span className="text-xs sm:text-sm font-bold text-slate-600 uppercase tracking-wide">
                {card.label}
              </span>
            </div>
            <div className="text-3xl font-black text-slate-900 mt-1">{card.value}</div>
          </div>
        ))}
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl text-sm font-semibold border-2 flex items-center justify-between ${
            messageKind === 'error'
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {messageKind === 'error' ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
            <span>{message}</span>
          </div>
          <button onClick={() => setMessage('')} className="text-slate-500 hover:text-slate-800">
            <X size={18} />
          </button>
        </div>
      )}

      {/* 3. DISPATCH USER FORM (Raise Dispatch Order) */}
      {isDispatch && (
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <Plus size={20} className="text-brand-600" />
            <h2 className="text-lg font-bold text-slate-900">Create dispatch order</h2>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                Select stock batches * ({selectedBatchIds.length} selected)
              </label>
              {qcPassedBatches.length > 0 && (
                <div className="flex items-center gap-2 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setSelectedBatchIds(qcPassedBatches.map((b) => String(b.id)))}
                    className="text-brand-600 hover:text-brand-800"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedBatchIds([])}
                    className="text-slate-500 hover:text-slate-800"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {qcPassedBatches.length === 0 ? (
              <p className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm font-medium text-amber-800">
                No stocked batches are currently available for dispatch.
              </p>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-slate-50">
                {qcPassedBatches.map((batch: any) => {
                  const isChecked = selectedBatchIds.includes(String(batch.id));
                  return (
                    <label
                      key={batch.id}
                      className={`flex items-start gap-3 p-3.5 cursor-pointer transition-colors ${
                        isChecked ? 'bg-brand-50 border-l-4 border-l-brand-600' : 'hover:bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
                        checked={isChecked}
                        onChange={(e) => {
                          const idStr = String(batch.id);
                          if (e.target.checked) {
                            setSelectedBatchIds((prev) => [...prev, idStr]);
                          } else {
                            setSelectedBatchIds((prev) => prev.filter((id) => id !== idStr));
                          }
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900">{batch.product_name}</span>
                          <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-bold">
                            {batch.batch_number}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-4">
              <span>Quantity: <strong className="text-slate-800">{batch.quantity} {batch.uom || ''}</strong></span>
                          <span>Location: <strong className="text-slate-800">{batch.location_code || batch.storage_location || 'Not set'}</strong></span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
              Client / Destination Party *
            </label>
            <select
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">-- Select Client --</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} {client.gst_number ? `· GST: ${client.gst_number}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                Driver Name *
              </label>
              <input
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Driver name"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                Vehicle / Truck Number *
              </label>
              <input
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="e.g. MH-12-AB-1234"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                Container Number *
              </label>
              <input
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="e.g. CONT-9988"
                value={containerNumber}
                onChange={(e) => setContainerNumber(e.target.value)}
              />
            </div>
          </div>

          <button
            onClick={handleRaiseOrder}
            disabled={
              !selectedBatchIds.length ||
              !clientId ||
              !driverName.trim() ||
              !vehicleNumber.trim() ||
              !containerNumber.trim() ||
              actionLoading
            }
            className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm rounded-xl transition-colors shadow-sm disabled:opacity-50"
          >
            {actionLoading ? 'Creating dispatch order…' : 'Create order and packaging list'}
          </button>
        </div>
      )}

      {/* 4. SEARCH & STATUS FILTER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full pl-10 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Search by product name or batch number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="PENDING">Pending QC</option>
          <option value="APPROVED">Ready for Loading</option>
          <option value="DISPATCHED">Dispatched (Completed)</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {/* 5. ORDERS TABLE (High Contrast, Readable Columns) */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b-2 border-slate-200 text-slate-600 font-bold uppercase text-xs tracking-wider">
              <tr>
                <th className="px-5 py-4">Product &amp; Batch</th>
                <th className="px-5 py-4">Client Destination</th>
                <th className="px-5 py-4">Transport Info</th>
                <th className="px-5 py-4">Order Date</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((order) => {
                const badge = getOrderStatusBadge(order);
                const canDownload = canDownloadPackingList(order);

                return (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-900 text-base">
                        {order.product_name}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                        <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                          {order.batch_number}
                        </span>
                        <span>•</span>
                        <span className="font-semibold text-slate-700">{order.quantity} {order.uom || ''}</span>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-800">
                        {order.client_name || 'Standard Client'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Raised by: <span className="font-medium text-slate-700">{order.raised_by_name || 'Staff'}</span>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="text-sm font-semibold text-slate-800">
                        {order.vehicle_number || 'No Vehicle'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Driver: {order.driver_name || '-'} · Cont: {order.container_number || '-'}
                      </div>
                    </td>

                    <td className="px-5 py-4 text-sm font-medium text-slate-500">
                      {order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}
                    </td>

                    <td className="px-5 py-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${badge.bg}`}>
                        {badge.label}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {isQc && order.status === 'PENDING' && (
                          <button
                            onClick={() => {
                              setSelectedOrder(order);
                              setRemarks(order.admin_remarks || '');
                              setMessage('');
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                          >
                            Review Order
                          </button>
                        )}

                        {isDispatch && order.status === 'APPROVED' && order.batch_status !== 'LOADING' && (
                          <button
                            onClick={() => navigate(`/dispatch?order=${order.id}`)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                          >
                            <Truck size={14} /> Start Loading
                          </button>
                        )}

                        {canDownload && (
                          <>
                            <button
                              onClick={() => navigate(`/packing-list?order=${order.id}`)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200"
                            >
                              <FileText size={14} /> Packing List
                            </button>
                            <button
                              onClick={() => handleDownloadPdf(order)}
                              disabled={downloadingId === String(order.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200"
                            >
                              <Download size={14} />
                              {downloadingId === String(order.id) ? 'Downloading...' : 'PDF'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && list.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                      <Truck size={24} />
                    </div>
                    <p className="text-base font-bold text-slate-700">No dispatch orders match your criteria</p>
                    <p className="text-sm text-slate-500 mt-0.5">Try searching for a different batch number or changing the filter.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. QC REVIEW MODAL */}
      {selectedOrder && isQc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Review Dispatch Request</h2>
                <p className="text-xs text-slate-500 mt-0.5">Order #{selectedOrder.id} · {selectedOrder.product_name}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedOrder(null);
                  setRemarks('');
                }}
                disabled={actionLoading}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3.5 bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm">
                <div>
                  <span className="block text-xs font-bold text-slate-500 uppercase">Batch Number</span>
                  <span className="font-mono font-bold text-slate-900">{selectedOrder.batch_number || '-'}</span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-slate-500 uppercase">Client</span>
                  <span className="font-bold text-slate-900">{selectedOrder.client_name || '-'}</span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-slate-500 uppercase">Transport</span>
                  <span className="font-medium text-slate-800">{selectedOrder.driver_name || '-'} · {selectedOrder.vehicle_number || '-'}</span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-slate-500 uppercase">Container</span>
                  <span className="font-medium text-slate-800">{selectedOrder.container_number || '-'}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  QC Remarks <span className="font-normal text-slate-400">(Required to reject)</span>
                </label>
                <textarea
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  rows={3}
                  placeholder="Enter approval note or reason for rejection..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  disabled={actionLoading}
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOrder(null);
                    setRemarks('');
                  }}
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(selectedOrder.id)}
                  disabled={actionLoading || !remarks.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 disabled:opacity-50"
                >
                  <XCircle size={16} /> Reject Order
                </button>
                <button
                  type="button"
                  onClick={() => handleApprove(selectedOrder.id)}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                >
                  <CheckCircle size={16} /> {actionLoading ? 'Approving...' : 'Approve Order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
