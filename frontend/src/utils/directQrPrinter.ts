import qz from 'qz-tray';
import QRCode from 'qrcode';
import { api } from '../services/api';
import type { QrJob, QrLabel, QrLabelSize } from './qrPdf';

let signingConfigured = false;
let activeCertificate: string | null = null;
type QzPrinterEvent = { printerName?: string; jobName?: string; eventType?: string; statusText?: string; severity?: string; message?: string };
const printerEventListeners = new Set<(event: QzPrinterEvent) => void>();
let printerCallbacksConfigured = false;

function listenForPrinterEvents(): void {
  if (printerCallbacksConfigured) return;
  qz.printers.setPrinterCallbacks((event) => printerEventListeners.forEach((listener) => listener(event)));
  printerCallbacksConfigured = true;
}

function watchQueueJob(jobName: string, printerName: string, onProgress?: (sent: number, total: number, status?: string) => void) {
  let latest: QzPrinterEvent | null = null;
  let resolveWait: (() => void) | null = null;
  let rejectWait: ((error: Error) => void) | null = null;
  const isFinished = (event: QzPrinterEvent) => event.statusText === 'COMPLETE' || event.statusText === 'DELETED';
  const isFailed = (event: QzPrinterEvent) =>
    event.severity === 'ERROR' ||
    event.severity === 'FATAL' ||
    ['ABORTED', 'ERROR', 'OFFLINE', 'PAPEROUT', 'USER_INTERVENTION'].includes(event.statusText || '');
  const failure = (event: QzPrinterEvent) =>
    new Error(`Windows printer queue reported ${event.statusText || event.severity}${event.message ? `: ${event.message}` : ''}.`);
  const handler = (event: QzPrinterEvent) => {
    if (event.printerName && event.printerName !== printerName) return;
    if (event.jobName !== jobName) return;
    latest = event;
    if (event.statusText) onProgress?.(0, 0, `Windows queue ${jobName}: ${event.statusText}${event.message ? ` — ${event.message}` : ''}`);
    if (isFinished(event)) resolveWait?.();
    else if (isFailed(event)) rejectWait?.(failure(event));
  };
  printerEventListeners.add(handler);
  return {
    wait: () => new Promise<void>((resolve, reject) => {
      if (latest && isFinished(latest)) { resolve(); return; }
      if (latest && isFailed(latest)) { reject(failure(latest)); return; }
      const timer = window.setTimeout(() => {
        // qz.print() already resolved, so Windows has accepted the job. Some
        // label printers never report a terminal queue status, and treating
        // that silence as failure made the UI report a successful print as
        // lost, which encouraged duplicate reprints. Report it as unconfirmed.
        onProgress?.(0, 0, `Windows accepted ${jobName}, but the ${printerName} queue did not report completion. Check the queue before reprinting.`);
        resolve();
      }, 20_000);
      resolveWait = () => { window.clearTimeout(timer); resolve(); };
      rejectWait = (error) => { window.clearTimeout(timer); reject(error); };
    }),
    close: () => printerEventListeners.delete(handler),
  };
}

function configureSigning(): void {
  if (signingConfigured) return;
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((request) => (resolve, reject) => {
    api.printer.sign(request).then(resolve, reject);
  });
  signingConfigured = true;
}

async function connectToQz(certificate: string): Promise<void> {
  configureSigning();
  // QZ keeps the certificate a connection was opened with. If the backend
  // rotates its signing certificate, an already-open tab would keep failing
  // every signed call until the page was reloaded.
  if (qz.websocket.isActive() && activeCertificate !== null && activeCertificate !== certificate) {
    await qz.websocket.disconnect().catch(() => undefined);
  }
  if (qz.websocket.isActive()) return;
  qz.security.setCertificatePromise((resolve) => resolve(certificate));
  await qz.websocket.connect();
  activeCertificate = certificate;
}

function isVirtualPdfPrinter(name: string): boolean {
  return /\b(pdf|xps|onenote|fax)\b/i.test(name);
}

export async function prepareDirectQrPrinter(): Promise<string> {
  let stage = 'loading the server signing certificate';
  try {
    // Check backend signing before connecting, so a missing certificate/key is
    // reported distinctly from QZ Tray not running on the workstation.
    const certificate = await api.printer.certificate().then((value) => value.trim());
    stage = 'connecting to QZ Tray on this computer';
    await connectToQz(certificate);
    stage = 'reading the Windows default printer';
    const printer = await qz.printers.getDefault();
    if (!printer) throw new Error('No default printer is configured on this computer.');
    if (isVirtualPdfPrinter(printer)) {
      throw new Error('The computer default is a PDF or virtual printer. Set a physical label printer as the default printer and try again.');
    }
    return printer;
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (/signing is not configured/i.test(message)) {
      throw new Error('The backend is missing QZ_CERTIFICATE or QZ_PRIVATE_KEY. An administrator must configure both trusted QZ signing values and restart the backend. No batch was created.');
    }
    if (/default printer|virtual printer/i.test(message)) throw error;
    throw new Error(`Direct printing stopped while ${stage}${message ? `: ${message}` : '.'} No batch was created.`);
  }
}

export async function printQrLabelsDirect(
  labels: QrLabel[],
  job: QrJob,
  labelSize: QrLabelSize,
  printerName: string,
  onProgress?: (sent: number, total: number, status?: string) => void,
): Promise<void> {
  if (labels.length === 0) return;
  const widthMm = Math.max(30, Math.min(200, Math.round(labelSize.widthMm || 60)));
  const heightMm = Math.max(30, Math.min(250, Math.round(labelSize.heightMm || 64)));
  listenForPrinterEvents();
  const queueStatusEnabled = await qz.printers.startListening(printerName).then(() => true).catch(() => false);

  // Rasterize each label in the browser and send it as a PNG image. This avoids
  // QZ's embedded HTML renderer and gives the printer driver a fixed-size page.
  const pageWidth = Math.round(widthMm * 8);
  const pageHeight = Math.round(heightMm * 8);
  const qrSide = Math.max(96, Math.min(pageWidth - 48, Math.round(pageHeight * 0.56)));
  const queueJobs: ReturnType<typeof watchQueueJob>[] = [];
  try {
  for (let start = 0; start < labels.length; start += 6) {
    const chunkEnd = Math.min(start + 6, labels.length);
    const jobName = `QR-${job.job_code}-${start + 1}-${chunkEnd}`;
    const queueJob = watchQueueJob(jobName, printerName, onProgress);
    queueJobs.push(queueJob);
    const config = qz.configs.create(printerName, {
      units: 'mm',
      // `custom` is required to keep the requested size for media that is not
      // in the printer driver's list (60x64 mm labels are not a standard size).
      // Without it QZ validates the page against the driver and silently falls
      // back to the driver default, so labels print offset or on the wrong size.
      size: { width: widthMm, height: heightMm, custom: true },
      margins: 0,
      copies: 1,
      colorType: 'grayscale',
      interpolation: 'nearest-neighbor',
      // QZ runs `breakupOverPages` for non-scaled images, which can split one
      // label across several pages when the printer resolution differs from the
      // requested size. Scaling keeps exactly one image per page.
      scaleContent: true,
      jobName,
    });
      const pages = await Promise.all(labels.slice(start, start + 6).map(async (label) => {
        const qrDataUrl = await QRCode.toDataURL(label.qr_value, {
          width: Math.max(320, qrSide), margin: 1, errorCorrectionLevel: 'M',
        });
        const qrImage = await loadImage(qrDataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = pageWidth;
        canvas.height = pageHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not prepare the QR label image.');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, pageWidth, pageHeight);
        context.textAlign = 'center';
        context.fillStyle = '#111827';
        context.font = `bold ${Math.max(15, Math.round(pageWidth * 0.045))}px Arial`;
        context.fillText(fitText(context, label.product_name || job.product_name, pageWidth - 24), pageWidth / 2, Math.round(pageHeight * 0.09));
        context.fillStyle = '#334155';
        context.font = `${Math.max(12, Math.round(pageWidth * 0.034))}px Arial`;
        context.fillText(fitText(context, `${label.batch_number} · Unit ${String(label.serial_no).padStart(4, '0')}`, pageWidth - 20), pageWidth / 2, Math.round(pageHeight * 0.15));
        const drawnQrSide = Math.min(qrSide, pageWidth - 48, Math.round(pageHeight * 0.59));
        context.imageSmoothingEnabled = false;
        context.drawImage(qrImage, (pageWidth - drawnQrSide) / 2, Math.round(pageHeight * 0.19), drawnQrSide, drawnQrSide);
        context.fillStyle = '#64748b';
        context.font = `${Math.max(9, Math.round(pageWidth * 0.021))}px Arial`;
        context.fillText(fitText(context, label.qr_value, pageWidth - 20), pageWidth / 2, Math.min(pageHeight - 10, Math.round(pageHeight * 0.94)));
        return {
          type: 'pixel' as const,
          format: 'image' as const,
          flavor: 'base64' as const,
          data: canvas.toDataURL('image/png').split(',')[1],
        };
      }));
      await qz.print(config, pages);
      onProgress?.(chunkEnd, labels.length, `Sent ${chunkEnd} / ${labels.length} label images to the ${printerName} queue…`);
  }
  if (queueStatusEnabled) {
    await Promise.all(queueJobs.map((queueJob) => queueJob.wait()));
  } else {
    onProgress?.(labels.length, labels.length, 'QZ Tray accepted the print job. Windows queue status is unavailable.');
  }
  } finally {
    queueJobs.forEach((queueJob) => queueJob.close());
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not encode a QR label for printing.'));
    image.src = src;
  });
}

function fitText(context: CanvasRenderingContext2D, value: unknown, maxWidth: number): string {
  const text = String(value ?? '');
  if (context.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
}
