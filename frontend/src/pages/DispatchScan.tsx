import { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';
import { api } from '../services/api';

const reader = new BrowserMultiFormatReader();

export default function DispatchScan() {
  const [scanning, setScanning] = useState(false);
  const [batch, setBatch] = useState<any>(null);
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState('');
  const [todayDispatches, setTodayDispatches] = useState<any[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = () => {
    reader.reset();
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  useEffect(() => {
    api.dispatch.today().then(setTodayDispatches);
    return () => cleanup();
  }, []);

  const startScan = async () => {
    cleanup();
    setScanning(true);
    setMessage(''); setBatch(null); setRemarks('');
    try {
      timerRef.current = setTimeout(() => {
        cleanup();
        setScanning(false);
        setMessage('No QR code detected. Try again.');
      }, 120000);

      await reader.decodeFromVideoDevice(null, videoRef.current!, (result) => {
        if (result) {
          cleanup();
          const text = result.getText();
          api.batches.getByBarcode(text)
            .then(b => {
              if (b.status === 'DISPATCHED') {
                setMessage(`Batch ${b.batch_number} already dispatched.`);
              } else if (b.status !== 'QC_PASSED') {
                setMessage(`Batch ${b.batch_number} cannot be dispatched. Status: ${b.status}. Must be QC_PASSED.`);
              } else {
                setBatch(b); setMessage('');
              }
            })
            .catch(() => setMessage(`No batch found for QR: "${text}"`));
          setScanning(false);
        }
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setMessage('Camera permission denied.');
      } else {
        setMessage(`Camera error: ${msg}`);
      }
      cleanup();
      setScanning(false);
    }
  };

  const handleDispatch = async () => {
    if (!batch) return;
    try {
      await api.dispatch.submit({ barcode_value: batch.barcode_value, remarks: remarks || undefined });
      setMessage(`Batch ${batch.batch_number} dispatched successfully!`);
      setBatch(null); setRemarks('');
      api.dispatch.today().then(setTodayDispatches);
    } catch (err: any) { setMessage(`Error: ${err.message}`); }
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">Dispatch</h1>
      <div className="bg-white p-4 rounded shadow mb-4">
        {!scanning && !batch && (
          <>
            <label className="block text-sm mb-2">Enter QR code manually or scan with camera:</label>
            <input className="w-full border p-2 rounded mb-3" placeholder="QR code value" onChange={async e => { const val = e.target.value; setBatch(null); setMessage(''); if (!val) return; try { const b = await api.batches.getByBarcode(val); if (b.status === 'DISPATCHED') { setMessage(`Batch ${b.batch_number} already dispatched.`); } else if (b.status !== 'QC_PASSED') { setMessage(`Batch ${b.batch_number} cannot be dispatched. Status: ${b.status}. Must be QC_PASSED.`); } else { setBatch(b); } } catch { setMessage('No batch found for this QR code.'); } }} />
            <button className="bg-green-700 text-white px-4 py-2 rounded hover:bg-green-800 w-full" onClick={startScan}>
              Scan with Camera
            </button>
          </>
        )}
        {scanning && !batch && (
          <div className="space-y-2">
            <video ref={videoRef} style={{ width: '100%', height: '300px', background: '#000', objectFit: 'cover' }} playsInline />
            <p className="text-center text-sm text-blue-600 animate-pulse">Scanning for QR code...</p>
            <button className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 w-full" onClick={() => { cleanup(); setScanning(false); }}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {batch && (
        <div className="bg-white p-4 rounded shadow space-y-3">
          <h2 className="font-bold text-lg">Batch: {batch.batch_number}</h2>
          <div className="bg-gray-50 p-3 rounded text-xs grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-gray-500">Product:</span><span className="font-medium">{batch.product_name}</span>
            <span className="text-gray-500">SKU:</span><span className="font-mono">{batch.product_sku}</span>
            <span className="text-gray-500">Qty:</span><span>{batch.quantity}</span>
            <span className="text-gray-500">Price:</span><span>{batch.unit_price ? `₹${Number(batch.unit_price).toLocaleString()}` : '-'}</span>
            <span className="text-gray-500">Mfg:</span><span>{batch.manufacturing_date ? new Date(batch.manufacturing_date).toLocaleDateString() : '-'}</span>
            <span className="text-gray-500">Exp:</span><span>{batch.expiry_date ? new Date(batch.expiry_date).toLocaleDateString() : '-'}</span>
            <span className="text-gray-500">Notes:</span><span>{batch.notes || '-'}</span>
            <span className="text-gray-500">Status:</span><span className={`font-bold ${batch.status === 'DISPATCHED' ? 'text-red-600' : 'text-green-600'}`}>{batch.status}</span>
          </div>
          <div className="text-[10px] text-gray-400 text-center">QR: <code className="font-mono">{batch.barcode_value}</code></div>
          <textarea className="w-full border p-2 rounded" placeholder="Remarks / destination (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} />
          <button className="w-full bg-blue-800 text-white p-2 rounded hover:bg-blue-900" onClick={handleDispatch}>
            Dispatch Batch
          </button>
          <button className="w-full bg-gray-300 text-gray-700 p-2 rounded hover:bg-gray-400" onClick={() => { setBatch(null); }}>
            Scan Another
          </button>
        </div>
      )}
      {message && (
        <div className={`mt-4 text-sm text-center p-2 rounded ${message.includes('Error') || message.includes('No batch') || message.includes('cannot') || message.includes('already dispatched') || message.includes('No QR') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}
      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Dispatched Today</h2>
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr><th className="p-2 text-left">Product</th><th className="p-2 text-left">Batch</th><th className="p-2 text-left">Time</th></tr>
            </thead>
            <tbody>
              {todayDispatches.map((d: any) => (
                <tr key={d.id} className="border-t">
                  <td className="p-2">{d.product_name}</td>
                  <td className="p-2">{d.batch_number}</td>
                  <td className="p-2">{new Date(d.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
              {todayDispatches.length === 0 && <tr><td colSpan={3} className="p-2 text-gray-500">No dispatches today</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
