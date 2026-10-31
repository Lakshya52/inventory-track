import { useEffect, useRef, useState } from 'react';
import { Check, Crop, Minus, Plus, X } from 'lucide-react';

type Props = { file: File; onCancel: () => void; onComplete: (cropped: File) => void };

export function LogoCropper({ file, onCancel, onComplete }: Props) {
  const [source, setSource] = useState('');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef({ x: 0, y: 0, originX: 0, originY: 0 });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
    setDragging(true);
  };

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setOffset({ x: dragRef.current.originX + event.clientX - dragRef.current.x, y: dragRef.current.originY + event.clientY - dragRef.current.y });
  };

  const crop = async () => {
    const image = imageRef.current;
    if (!image) return;
    setBusy(true); setError('');
    try {
      const side = 512;
      const viewport = viewportRef.current?.getBoundingClientRect();
      const viewportSide = Math.min(viewport?.width || 320, viewport?.height || 320);
      const outputScale = side / viewportSide;
      const scale = Math.max(side / image.naturalWidth, side / image.naturalHeight) * zoom;
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const centerX = side / 2 + offset.x * outputScale;
      const centerY = side / 2 + offset.y * outputScale;
      const canvas = document.createElement('canvas');
      canvas.width = side; canvas.height = side;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the cropped image.');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, side, side);
      context.drawImage(image, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not export the cropped image.')), 'image/png'));
      const cropped = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-logo.png`, { type: 'image/png', lastModified: Date.now() });
      if (cropped.size > 2 * 1024 * 1024) throw new Error('The cropped logo is larger than 2 MB. Zoom out or choose a smaller image.');
      onComplete(cropped);
    } catch (err: any) { setError(err.message || 'Could not crop this image.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="modal-content max-w-lg" role="dialog" aria-modal="true" aria-labelledby="logo-crop-title">
        <header className="modal-header"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Crop size={18} /></span><div><h2 id="logo-crop-title" className="font-semibold text-surface-900">Crop organization logo</h2><p className="text-xs text-surface-500">Drag to position, then adjust the zoom.</p></div></div><button type="button" className="btn-ghost p-2" onClick={onCancel} aria-label="Cancel logo crop"><X size={18} /></button></header>
        <div className="space-y-5 p-6">
          <div ref={viewportRef} className="relative mx-auto aspect-square w-full max-w-[320px] touch-none select-none overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-inner cursor-grab active:cursor-grabbing" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}>
            {source && <img ref={imageRef} src={source} alt="Logo crop source" draggable={false} onLoad={event => { setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setZoom(1); setOffset({ x: 0, y: 0 }); }} className="pointer-events-none absolute h-px w-px opacity-0" />}
            {source && <div className="relative h-full w-full overflow-hidden"><img src={source} alt="Logo crop preview" draggable={false} className="pointer-events-none absolute left-1/2 top-1/2 max-w-none" style={{ width: imageSize.width ? `${Math.max(100, 100 * imageSize.width / imageSize.height) * zoom}%` : 'auto', height: imageSize.height ? `${Math.max(100, 100 * imageSize.height / imageSize.width) * zoom}%` : 'auto', transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }} /></div>}
          </div>
          <div className="flex items-center gap-3"><button type="button" className="btn-secondary p-2" onClick={() => setZoom(value => Math.max(1, Math.round((value - 0.1) * 10) / 10))} aria-label="Zoom out"><Minus size={16} /></button><input className="w-full accent-brand-600" type="range" min="1" max="3" step="0.05" value={zoom} onChange={event => setZoom(Number(event.target.value))} aria-label="Logo zoom" /><button type="button" className="btn-secondary p-2" onClick={() => setZoom(value => Math.min(3, Math.round((value + 0.1) * 10) / 10))} aria-label="Zoom in"><Plus size={16} /></button></div>
          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button><button type="button" className="btn-primary" onClick={() => void crop()} disabled={busy || !source}>{busy ? 'Preparing…' : <><Check size={16} />Use cropped logo</>}</button></div>
        </div>
      </section>
    </div>
  );
}
