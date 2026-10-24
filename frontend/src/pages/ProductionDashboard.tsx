import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../services/api';
import { FlaskConical, Wrench, CheckCircle, XCircle, AlertTriangle, FileWarning } from 'lucide-react';

export default function ProductionDashboard() {
  const [batches, setBatches] = useState<any[]>([]);
  const [fixRecords, setFixRecords] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [fixDesc, setFixDesc] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'batches' | 'fixes'>('batches');
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => { fetchData(); }, []);

  const fetchData = () => {
    api.production.batches().then(setBatches).catch(err => setMessage(`Error: ${err.message}`));
    api.production.fixRecords().then(setFixRecords).catch(() => {});
  };

  const handleFix = async () => {
    if (!selectedBatch || !fixDesc) { setMessage('Please enter a fix description'); return; }
    try {
      await api.production.fixBatch(selectedBatch.id, fixDesc);
      setMessage(`Batch ${selectedBatch.batch_number} fixed and sent back to QC`);
      setSelectedBatch(null); setFixDesc('');
      fetchData();
    } catch (err: any) { setMessage(`Error: ${err.message}`); }
  };

  const handleShowQr = async (batch: any) => {
    try {
      const url = await QRCode.toDataURL(batch.barcode_value, { width: 300, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } });
      setQrDataUrl(url);
    } catch { setQrDataUrl(''); }
  };

  const created = batches.filter((b: any) => b.status === 'CREATED').length;
  const failed = batches.filter((b: any) => b.status === 'QC_FAILED').length;
  const approved = batches.filter((b: any) => b.status === 'DISPATCH_APPROVED').length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Production Interface</h1>
          <p className="page-subtitle">Manage batches and fix QC failures</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setTab('batches')} className={`btn-sm ${tab === 'batches' ? 'btn-primary' : 'btn-secondary'}`}><FlaskConical size={14} /> Batches</button>
          <button onClick={() => setTab('fixes')} className={`btn-sm ${tab === 'fixes' ? 'btn-primary' : 'btn-secondary'}`}><Wrench size={14} /> Fix Records</button>
        </div>
      </div>

      {message && !selectedBatch && (
        <div className={`mb-4 p-3 rounded-xl text-sm flex items-center justify-between ${
          message.includes('Error')
            ? 'bg-rose-50 text-rose-700 border border-rose-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-surface-400 hover:text-surface-600">✕</button>
        </div>
      )}

      {tab === 'batches' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="card p-5 text-center">
              <div className="text-3xl font-bold text-surface-800 mb-1">{created}</div>
              <div className="text-xs font-medium text-surface-500 uppercase tracking-wider">In Production</div>
            </div>
            <div className="card p-5 text-center">
              <div className="text-3xl font-bold text-rose-600 mb-1">{failed}</div>
              <div className="text-xs font-medium text-surface-500 uppercase tracking-wider">Needs Fix</div>
            </div>
            <div className="card p-5 text-center">
              <div className="text-3xl font-bold text-sky-600 mb-1">{approved}</div>
              <div className="text-xs font-medium text-surface-500 uppercase tracking-wider">Approved for Dispatch</div>
            </div>
          </div>

          {selectedBatch && (
            <div className="card p-6 mb-6 border-l-4 border-l-amber-500 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-surface-800 flex items-center gap-2"><FileWarning size={18} className="text-amber-500" /> Fix Batch: {selectedBatch.batch_number}</h3>
                <span className="badge badge-danger">QC_FAILED</span>
              </div>
              <p className="text-sm text-surface-500">Product: {selectedBatch.product_name} ({selectedBatch.product_sku})</p>
              <textarea className="input" rows={3} placeholder="Describe the fix applied *" value={fixDesc} onChange={e => setFixDesc(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn-primary" onClick={handleFix}><Wrench size={16} /> Submit Fix</button>
                <button className="btn-secondary" onClick={() => { setSelectedBatch(null); setFixDesc(''); setMessage(''); }}>Cancel</button>
              </div>
              {message && <div className={`text-sm ${message.includes('Error') ? 'text-rose-600 bg-rose-50 p-3 rounded-xl' : 'text-emerald-600 bg-emerald-50 p-3 rounded-xl'}`}>{message}</div>}
            </div>
          )}

          {qrDataUrl && (
            <div className="modal-overlay" onClick={() => setQrDataUrl('')}>
              <div className="modal-content max-w-xs" onClick={e => e.stopPropagation()}>
                <div className="modal-header"><h3 className="text-base font-semibold text-surface-800">QR Code</h3></div>
                <div className="p-6 flex flex-col items-center gap-4">
                  <img src={qrDataUrl} alt="QR Code" className="w-48 h-48" />
                </div>
                <div className="modal-footer">
                  <button className="btn-primary w-full" onClick={() => { const a = document.createElement('a'); a.href = qrDataUrl; a.download = 'qrcode.png'; a.click(); }}>Download</button>
                  <button className="btn-secondary w-full" onClick={() => setQrDataUrl('')}>Close</button>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header"><h3 className="section-title flex items-center gap-2"><FlaskConical size={16} className="text-surface-400" /> All Batches</h3></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Product</th><th>Batch #</th><th>Qty</th><th>Location</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {batches.map((b: any) => (
                    <tr key={b.id}>
                      <td>
                        <div className="font-medium text-surface-800">{b.product_name}</div>
                        <div className="text-xs text-surface-400">{b.product_sku}</div>
                      </td>
                      <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{b.batch_number}</span></td>
                      <td className="text-sm">{b.quantity} {b.uom || ''}</td>
                      <td className="text-sm text-surface-500">{b.storage_location || '-'}</td>
                      <td><span className={`badge ${
                        b.status === 'CREATED' ? 'badge-neutral' :
                        b.status === 'QC_PASSED' ? 'badge-success' :
                        b.status === 'QC_FAILED' ? 'badge-danger' :
                        b.status === 'DISPATCH_ORDER_RAISED' ? 'badge-warning' :
                        b.status === 'DISPATCH_APPROVED' ? 'badge-info' :
                        b.status === 'DISPATCH_REJECTED' ? 'badge-danger' :
                        'badge-neutral'
                      }`}>{b.status}</span></td>
                      <td>
                        <div className="flex gap-1">
                          <button onClick={() => handleShowQr(b)} className="btn-secondary btn-xs">QR</button>
                          {b.status === 'QC_FAILED' && (
                            <button onClick={() => { setSelectedBatch(b); setFixDesc(''); setMessage(''); }} className="btn-xs bg-amber-500 text-white hover:bg-amber-600">
                              <Wrench size={12} /> Fix
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {batches.length === 0 && <tr><td colSpan={6}><div className="empty-state"><div className="empty-title">No active batches in production</div></div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'fixes' && (
        <div className="card">
          <div className="card-header"><h3 className="section-title flex items-center gap-2"><Wrench size={16} className="text-surface-400" /> Fix Records</h3></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Product</th><th>Batch</th><th>Fixed By</th><th>Description</th></tr>
              </thead>
              <tbody>
                {fixRecords.map((r: any) => (
                  <tr key={r.id}>
                    <td className="text-xs text-surface-400">{new Date(r.created_at).toLocaleString()}</td>
                    <td><span className="font-medium text-surface-800">{r.product_name}</span></td>
                    <td><span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">{r.batch_number}</span></td>
                    <td className="text-sm">{r.fixed_by_name || '-'}</td>
                    <td className="text-sm text-surface-500">{r.description || '-'}</td>
                  </tr>
                ))}
                {fixRecords.length === 0 && <tr><td colSpan={5}><div className="empty-state"><div className="empty-title">No fix records</div></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
