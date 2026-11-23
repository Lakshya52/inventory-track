import qz from 'qz-tray';
import { api } from '../services/api';
import { createQrLabelPdfBlob, type QrJob, type QrLabel, type QrLabelSize } from './qrPdf';

/** Terminal outcome of a Windows print queue job. */
export type QrPrintOutcome = {
  status: 'PRINTED' | 'CANCELLED' | 'FAILED';
  message?: string;
};

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
  let resolveWait: ((outcome: QrPrintOutcome) => void) | null = null;
  const statusOf = (event: QzPrinterEvent): QrPrintOutcome | null => {
    const status = String(event.statusText || '').toUpperCase();
    // Windows reports DELETED/CANCELLED when the operator cancels the job in
    // the print queue. That is NOT a successful print.
    if (status === 'COMPLETE') return { status: 'PRINTED' };
    if (status === 'DELETED' || status === 'CANCELLED' || status === 'CANCELED') {
      return { status: 'CANCELLED', message: `Print job ${jobName} was cancelled in the Windows queue.` };
    }
    if (
      event.severity === 'ERROR' ||
      event.severity === 'FATAL' ||
      ['ABORTED', 'ERROR', 'OFFLINE', 'PAPEROUT', 'USER_INTERVENTION'].includes(status)
    ) {
      return {
        status: 'FAILED',
        message: `Windows printer queue reported ${status || event.severity}${event.message ? `: ${event.message}` : ''}.`,
      };
    }
    return null;
  };
  const handler = (event: QzPrinterEvent) => {
    if (event.printerName && event.printerName !== printerName) return;
    if (event.jobName !== jobName) return;
    latest = event;
    if (event.statusText) onProgress?.(0, 0, `Windows queue ${jobName}: ${event.statusText}${event.message ? ` — ${event.message}` : ''}`);
    const outcome = statusOf(event);
    if (outcome) resolveWait?.(outcome);
  };
  printerEventListeners.add(handler);
  return {
    wait: () => new Promise<QrPrintOutcome>((resolve) => {
      if (latest) {
        const outcome = statusOf(latest);
        if (outcome) { resolve(outcome); return; }
      }
      const timer = window.setTimeout(() => {
        // qz.print() resolved, so Windows accepted the job. Many label printers
        // never emit a terminal queue status — report it as accepted but
        // unconfirmed so the UI does not claim a confirmed print.
        onProgress?.(0, 0, `Windows accepted ${jobName}, but the ${printerName} queue did not report completion. Check the queue before reprinting.`);
        resolve({
          status: 'PRINTED',
          message: `Windows accepted ${jobName} but did not report completion — check the ${printerName} queue.`,
        });
      }, 20_000);
      resolveWait = (outcome) => { window.clearTimeout(timer); resolve(outcome); };
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

export async function printQrPdfDirect(
  labels: QrLabel[],
  job: QrJob,
  labelSize: QrLabelSize,
  printerName: string,
  jobName: string,
  onProgress?: (sent: number, total: number, status?: string) => void,
): Promise<QrPrintOutcome> {
  if (labels.length === 0) return { status: 'PRINTED' };
  listenForPrinterEvents();
  const queueStatusEnabled = await qz.printers.startListening(printerName).then(() => true).catch(() => false);
  const queueJob = watchQueueJob(jobName, printerName, onProgress);
  try {
    // One label-sized PDF for every label. QZ sends the whole document as a
    // single Windows print job — no 6-label chunks and no per-label PNG payload.
    const pdf = await createQrLabelPdfBlob(labels, job, labelSize);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const config = qz.configs.create(printerName, {
      size: {
        width: Math.max(30, Math.min(200, Math.round(labelSize.widthMm || 60))),
        height: Math.max(30, Math.min(250, Math.round(labelSize.heightMm || 64))),
        custom: true,
      },
      margins: 0,
      copies: 1,
      colorType: 'grayscale',
      jobName,
    });
    await qz.print(config, [{ type: 'pdf', flavor: 'base64', data: btoa(binary) }]);
    onProgress?.(labels.length, labels.length, `Sent ${labels.length} label(s) as one print job to ${printerName}…`);
    if (!queueStatusEnabled) {
      onProgress?.(labels.length, labels.length, 'QZ Tray accepted the print job. Windows queue status is unavailable.');
      return { status: 'PRINTED', message: 'Windows queue status unavailable — check the printer.' };
    }
    return await queueJob.wait();
  } finally {
    queueJob.close();
  }
}
