import { useEffect, useState, FormEvent, useMemo } from 'react';
import JSZip from 'jszip';
import { api } from '../services/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Product, Batch } from '../types';
import {
  Layers,
  Plus,
  Search,
  X,
  PackageCheck,
  Download,
  Boxes,
  CheckCircle2,
  Truck,
  Clock,
  Sparkles,
} from 'lucide-react';
import { createQrPdfBlob, downloadQrPdf, type QrJob, type QrLabel } from '../utils/qrPdf';
import { useAuth } from '../contexts/AuthContext';

const statusBadgeStyle: Record<string, { bg: string; label: string }> = {
  QC_PASSED: { bg: 'bg-emerald-100 text-emerald-900 border-emerald-300', label: 'QC Passed (In Stock)' },
  DISPATCH_ORDER_RAISED: { bg: 'bg-purple-100 text-purple-900 border-purple-300', label: 'Order Raised' },
  DISPATCH_APPROVED: { bg: 'bg-blue-100 text-blue-900 border-blue-300', label: 'Ready for Loading' },
  LOADING: { bg: 'bg-indigo-100 text-indigo-900 border-indigo-300', label: 'Loading Truck' },
  DISPATCHED: { bg: 'bg-emerald-100 text-emerald-900 border-emerald-300', label: 'Dispatched' },
  NOT_DISPATCHED: { bg: 'bg-slate-100 text-slate-700 border-slate-300', label: 'Not Dispatched' },
};

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'batches';
}

async function downloadCreatedQrPdfs(
  batches: { batch_number: string; qr_job: QrJob; labels: QrLabel[] }[]
): Promise<void> {
  if (batches.length === 0) throw new Error('The server returned no QR labels for the created batches.');
  for (const batch of batches) {
    if (batch.labels.length !== Number(batch.qr_job.quantity)) {
      throw new Error(`Batch ${batch.batch_number} has ${batch.labels.length} QR labels; expected ${batch.qr_job.quantity}.`);
    }
  }
  if (batches.length === 1) {
    await downloadQrPdf(batches[0].labels, batches[0].qr_job);
    return;
  }

  const zip = new JSZip();
  for (const batch of batches) {
    zip.file(`${safeFileName(batch.batch_number)}.pdf`, await createQrPdfBlob(batch.labels, batch.qr_job));
  }
  const archive = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `QR-${safeFileName(batches[0].qr_job.product_sku || batches[0].qr_job.product_name)}-batches.zip`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hasUsableMasterId(row: any): boolean {
  const id = row?.id;
  return (typeof id === 'string' && id.trim().length > 0) ||
    (typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
}

function isActiveMaster(row: any): boolean {
  return row?.is_active == null || row.is_active === true || Number(row.is_active) === 1;
}

export default function Batches() {
  const { user } = useAuth();
  const canManageBatches = user?.role === 'QC';
  const canDownloadQr = user?.role === 'ADMIN' || canManageBatches;
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [bagQuantities, setBagQuantities] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [finishBatch, setFinishBatch] = useState<Batch | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [savingFinishGoods, setSavingFinishGoods] = useState(false);
  const [batchCount, setBatchCount] = useState('1');
  const [downloadingGroupId, setDownloadingGroupId] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [uom, setUom] = useState('pcs');
  const [unitPrice, setUnitPrice] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [shelfLocationId, setShelfLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [finishGoodsSelection, setFinishGoodsSelection] = useState({
    vendorId: '',
    gradeId: '',
    bagQuantityId: '',
  });

  useEffect(() => {
    Promise.all([
      api.products.list(),
      api.batches.list(),
      api.shelfLocations.list(),
      api.vendors.list({ status: 'active' }),
      api.masters.list('grades'),
      api.masters.list('bag-quantities'),
    ])
      .then(([productRows, batchRows, locationRows, vendorRows, gradeRows, bagQuantityRows]) => {
        setProducts(productRows);
        setBatches(batchRows);
        setLocations(locationRows.filter((loc: any) => hasUsableMasterId(loc) && isActiveMaster(loc)));
        setVendors(vendorRows.filter((ven: any) => hasUsableMasterId(ven) && isActiveMaster(ven)));
        setGrades(gradeRows.filter((grd: any) => hasUsableMasterId(grd) && isActiveMaster(grd)));
        setBagQuantities(bagQuantityRows.filter((val: any) => hasUsableMasterId(val) && isActiveMaster(val)));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  // Listen for Escape key to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!creatingBatch) setShowForm(false);
        if (!savingFinishGoods) setFinishBatch(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [creatingBatch, savingFinishGoods]);

  const selectedProduct = useMemo(() => products.find((p) => String(p.id) === productId), [productId, products]);

  const filteredBatches = useMemo(() => {
    if (!debouncedSearchQuery) return batches;
    const q = debouncedSearchQuery.toLowerCase();
    return batches.filter(
      (b) =>
        (b.product_name || '').toLowerCase().includes(q) ||
        (b.product_sku || '').toLowerCase().includes(q) ||
        b.batch_number.toLowerCase().includes(q) ||
        b.barcode_value.toLowerCase().includes(q)
    );
  }, [batches, debouncedSearchQuery]);

  const batchesByGroup = useMemo(() => {
    const groups = new Map<string, Batch[]>();
    batches.forEach((batch) => {
      if (!batch.batch_group_id) return;
      const group = groups.get(batch.batch_group_id) || [];
      group.push(batch);
      groups.set(batch.batch_group_id, group);
    });
    return groups;
  }, [batches]);

  const resetForm = () => {
    setProductId('');
    setBatchNumber('');
    setBatchCount('1');
    setQuantity('1');
    setUom('pcs');
    setUnitPrice('');
    setManufacturingDate('');
    setExpiryDate('');
    setShelfLocationId('');
    setNotes('');
    setError('');
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (creatingBatch) return;
    setError('');
    setSuccess('');
    const batchTotal = Number(batchCount);
    const unitCount = Number(quantity);
    const price = unitPrice.trim() ? Number(unitPrice) : 0;
    if (!Number.isInteger(batchTotal) || batchTotal < 1 || batchTotal > 100) {
      setError('Enter a whole-number batch count between 1 and 100.');
      return;
    }
    if (!Number.isInteger(unitCount) || unitCount < 1 || unitCount > 1000) {
      setError('Enter a whole-number product count between 1 and 1,000.');
      return;
    }
    if (batchTotal * unitCount > 10000) {
      setError('A single generation can contain no more than 10,000 products.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Enter a valid non-negative unit price.');
      return;
    }
    if (manufacturingDate && expiryDate && expiryDate < manufacturingDate) {
      setError('Expiry date cannot be earlier than the manufacturing date.');
      return;
    }
    setCreatingBatch(true);
    try {
      const created = await api.batches.create({
        product_id: productId,
        quantity: Number(quantity),
        batch_count: batchTotal,
        uom: uom || undefined,
        unit_price: price,
        manufacturing_date: manufacturingDate || undefined,
        expiry_date: expiryDate || undefined,
        notes: notes || undefined,
        ...(batchNumber.trim() ? { batch_number: batchNumber.trim() } : {}),
      } as Parameters<typeof api.batches.create>[0]);
      setShowForm(false);
      resetForm();
      setSuccess(`Created ${batchTotal} auto QC-passed batch${batchTotal === 1 ? '' : 'es'} with ${batchTotal * Number(quantity)} unit QR labels.`);
      try {
        await downloadCreatedQrPdfs(created.batches);
      } catch (downloadError: any) {
        setError(`Batches were created, but the QR download could not be completed: ${downloadError.message || 'QR PDF unavailable.'}`);
      }
      try {
        setBatches(await api.batches.list());
      } catch {
        // ignore list refresh error
      }
    } catch (err: any) {
      setError(err.message || 'Could not create QC batch');
    } finally {
      setCreatingBatch(false);
    }
  };

  const handleFinishGoods = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingFinishGoods) return;
    const vendorId = finishGoodsSelection.vendorId;
    const gradeId = finishGoodsSelection.gradeId;
    const bagQuantityId = finishGoodsSelection.bagQuantityId;
    const isValidSelection = (id: string, rows: any[]) =>
      id.length > 0 && rows.some((row) => String(row.id) === id && isActiveMaster(row));
    if (!finishBatch) return;
    if (
      !isValidSelection(vendorId, vendors) ||
      !isValidSelection(gradeId, grades) ||
      !isValidSelection(bagQuantityId, bagQuantities)
    ) {
      setError('Please select valid active supplier, grade, and bag quantity values.');
      return;
    }
    setError('');
    setSavingFinishGoods(true);
    try {
      const result = await api.batches.finishGoods(finishBatch.id, {
        vendor_id: vendorId,
        grade_id: gradeId,
        bag_quantity_id: bagQuantityId,
        shelf_location_id: shelfLocationId || undefined,
      });
      setSuccess(`Finished-goods details saved for ${finishBatch.batch_number}. Its ${result.labels.length} QR labels remain available.`);
      setFinishBatch(null);
      setShelfLocationId('');
      setFinishGoodsSelection({ vendorId: '', gradeId: '', bagQuantityId: '' });
      setBatches(await api.batches.list());
    } catch (err: any) {
      setError(err.message || 'Could not complete finished-goods details');
    } finally {
      setSavingFinishGoods(false);
    }
  };

  const handleDownloadGroupZip = async (groupBatches: Batch[]) => {
    const groupId = groupBatches[0]?.batch_group_id;
    if (!groupId) return;
    setDownloadingGroupId(groupId);
    setError('');
    try {
      const batchPayloads = await Promise.all(
        groupBatches.map(async (batch) => {
          if (!batch.qr_job_id) {
            throw new Error(`Batch ${batch.batch_number} does not have QR labels ready.`);
          }
          const detail = await api.qc.qrJobs.get(batch.qr_job_id);
          return { batch_number: batch.batch_number, qr_job: detail.job, labels: detail.labels };
        })
      );
      await downloadCreatedQrPdfs(batchPayloads);
      setSuccess(`Downloaded QR labels for group (${groupBatches.length} batches).`);
    } catch (err: any) {
      setError(err.message || 'Could not download ZIP archive');
    } finally {
      setDownloadingGroupId(null);
    }
  };

  const handlePrintQR = async (batch: Batch) => {
    if (!batch.qr_job_id) return;
    try {
      const detail = await api.qc.qrJobs.get(batch.qr_job_id);
      const reprinted = await api.qc.qrJobs.reprint(batch.qr_job_id, {
        label_ids: detail.labels.map((label: QrLabel) => label.id),
      });
      await downloadQrPdf(reprinted.labels, reprinted.job);
      setSuccess(`Downloaded QR labels for ${batch.batch_number}.`);
    } catch (err: any) {
      setError(err.message || 'Could not download batch QR labels');
    }
  };

  const totalBatches = batches.length;
  const inStockBatches = batches.filter((b) => b.status === 'QC_PASSED').length;
  const readyLoading = batches.filter((b) => b.status === 'DISPATCH_APPROVED' || b.status === 'DISPATCH_ORDER_RAISED').length;
  const dispatchedBatches = batches.filter((b) => b.status === 'DISPATCHED').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. PAGE HEADER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
            <Boxes size={24} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Batch Management
            </h1>
            <p className="text-sm sm:text-base text-slate-500 mt-0.5">
              Production lots, QC-passed inventory in warehouse storage, and unit QR label downloads.
            </p>
          </div>
        </div>

        {canManageBatches && (
          <button
            onClick={() => {
              setShowForm(!showForm);
              resetForm();
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm shrink-0"
          >
            <Plus size={18} />
            <span>Create New Batch</span>
          </button>
        )}
      </div>

      {/* 2. STATS CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Batches', value: totalBatches, icon: <Layers size={20} />, bg: 'bg-blue-100 text-blue-700' },
          { label: 'In Warehouse Stock', value: inStockBatches, icon: <CheckCircle2 size={20} />, bg: 'bg-emerald-100 text-emerald-700' },
          { label: 'In Dispatch Pipeline', value: readyLoading, icon: <Clock size={20} />, bg: 'bg-amber-100 text-amber-700' },
          { label: 'Dispatched', value: dispatchedBatches, icon: <Truck size={20} />, bg: 'bg-purple-100 text-purple-700' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
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

      {success && (
        <div className="p-4 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-800 border-2 border-emerald-200 flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-emerald-700 hover:text-emerald-900">
            <X size={18} />
          </button>
        </div>
      )}

      {error && !showForm && !finishBatch && (
        <div className="p-4 rounded-xl text-sm font-semibold bg-rose-50 text-rose-800 border-2 border-rose-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-700 hover:text-rose-900">
            <X size={18} />
          </button>
        </div>
      )}

      {/* 3. SEARCH BAR */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-4 shadow-xs flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full pl-10 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Search by product name, SKU, or batch number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
          >
            Clear
          </button>
        )}
      </div>

      {/* 4. BATCHES TABLE */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b-2 border-slate-200 text-slate-600 font-bold uppercase text-xs tracking-wider">
              <tr>
                <th className="px-5 py-4">Product Details</th>
                <th className="px-5 py-4">Batch Lot #</th>
                <th className="px-5 py-4">Quantity / Bags</th>
                <th className="px-5 py-4">Supplier &amp; Grade</th>
                <th className="px-5 py-4">Storage Location</th>
                <th className="px-5 py-4">Status</th>
                {canDownloadQr && <th className="px-5 py-4 text-right">QR / Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBatches.map((b) => {
                const batchGroup = b.batch_group_id ? batchesByGroup.get(b.batch_group_id) : undefined;
                const isFirstInGroup = batchGroup?.[0].id === b.id;
                const readyCount = batchGroup?.filter((batch) => batch.qr_job_id).length ?? 0;
                const badge = statusBadgeStyle[b.status] || {
                  bg: 'bg-slate-100 text-slate-800 border-slate-200',
                  label: b.status,
                };

                return (
                  <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-900 text-base">{b.product_name}</div>
                      <div className="text-xs text-slate-500 font-medium mt-0.5">{b.product_sku}</div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="font-mono text-xs font-bold px-2 py-1 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        {b.batch_number}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-900">{b.quantity} bags</div>
                      {b.bag_quantity && (
                        <div className="text-xs text-slate-500 font-medium mt-0.5">
                          {b.bag_quantity} {b.bag_quantity_unit} size
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-800">{b.vendor_name || 'Self'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {b.grade_name || b.product_grade || 'Standard Grade'}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="text-xs font-bold px-2 py-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {b.location_code || b.storage_location || 'Not set'}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${badge.bg}`}>
                        {badge.label}
                      </span>
                    </td>

                    {canDownloadQr && (
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {b.qr_job_id && (
                            <button
                              onClick={() => handlePrintQR(b)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200"
                              title="Download QR labels PDF"
                            >
                              <Download size={14} /> QR Labels
                            </button>
                          )}

                          {batchGroup && batchGroup.length > 1 && isFirstInGroup && (
                            readyCount === batchGroup.length ? (
                              <button
                                onClick={() => void handleDownloadGroupZip(batchGroup)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200"
                                disabled={downloadingGroupId === b.batch_group_id}
                              >
                                <Download size={14} /> {downloadingGroupId === b.batch_group_id ? 'Zipping…' : `All QR ZIP (${batchGroup.length})`}
                              </button>
                            ) : null
                          )}

                          {canManageBatches && b.status === 'QC_PASSED' && !b.fg_details_completed_at && (
                            <button
                              onClick={() => {
                                setFinishGoodsSelection({ vendorId: '', gradeId: '', bagQuantityId: '' });
                                setFinishBatch(b);
                                setShelfLocationId('');
                                setError('');
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                            >
                              <PackageCheck size={14} /> Complete Details
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}

              {filteredBatches.length === 0 && (
                <tr>
                  <td colSpan={canDownloadQr ? 7 : 6} className="py-12 text-center text-slate-400">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                      <Boxes size={24} />
                    </div>
                    <p className="text-base font-bold text-slate-700">No batches found</p>
                    <p className="text-sm text-slate-500 mt-0.5">Try searching for another product name or lot number.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. CREATE BATCH MODAL */}
      {canManageBatches && showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Create Auto-Passed QC Batch</h2>
                <p className="text-xs text-slate-500 mt-0.5">Generates auto QC-passed batches and ready-to-print QR labels</p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={creatingBatch}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                  Product *
                </label>
                <select
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    const p = products.find((x) => String(x.id) === e.target.value);
                    if (p?.price && p.price > 0) setUnitPrice(String(p.price));
                  }}
                  required
                >
                  <option value="">-- Select Product --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Batch Number (Optional)
                  </label>
                  <input
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="Auto-generated if blank"
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Number of Batches *
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="100"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={batchCount}
                    onChange={(e) => setBatchCount(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Quantity (Bags per Batch) *
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="1000"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Unit Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="e.g. 1500"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Manufacturing Date
                  </label>
                  <input
                    type="date"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={manufacturingDate}
                    onChange={(e) => setManufacturingDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Expiry Date
                  </label>
                  <input
                    type="date"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-800">
                  {error}
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={creatingBatch}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingBatch || !products.length}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
                >
                  {creatingBatch ? 'Creating Batches & QR Codes...' : 'Create QC Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. FINISH GOODS MODAL */}
      {finishBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Finished Goods Details — {finishBatch.batch_number}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Assign supplier, grade, and bag packaging to this QC-passed batch</p>
              </div>
              <button
                type="button"
                onClick={() => setFinishBatch(null)}
                disabled={savingFinishGoods}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleFinishGoods} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Supplier / Vendor *
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={finishGoodsSelection.vendorId}
                    onChange={(e) => setFinishGoodsSelection((prev) => ({ ...prev, vendorId: e.target.value }))}
                    required
                  >
                    <option value="">-- Select Supplier --</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={String(v.id)}>
                        {v.vendor_code === 'SELF' ? 'Self (Manufacturing Plant)' : v.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Grade *
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={finishGoodsSelection.gradeId}
                    onChange={(e) => setFinishGoodsSelection((prev) => ({ ...prev, gradeId: e.target.value }))}
                    required
                  >
                    <option value="">-- Select Grade --</option>
                    {grades.map((g) => (
                      <option key={g.id} value={String(g.id)}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Bag Quantity / Packaging *
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={finishGoodsSelection.bagQuantityId}
                    onChange={(e) => setFinishGoodsSelection((prev) => ({ ...prev, bagQuantityId: e.target.value }))}
                    required
                  >
                    <option value="">-- Select Packaging Size --</option>
                    {bagQuantities.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.quantity} {b.unit}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Godown / Shelf Location
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={shelfLocationId}
                    onChange={(e) => setShelfLocationId(e.target.value)}
                  >
                    <option value="">-- Select Shelf Location --</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.location_code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-800">
                  {error}
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setFinishBatch(null)}
                  disabled={savingFinishGoods}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFinishGoods}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
                >
                  <PackageCheck size={16} />
                  {savingFinishGoods ? 'Saving Details...' : 'Save Finished Goods'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
