import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import type { EntityId } from '../types';

export interface QrLabel {
  id: EntityId;
  qr_value: string;
  serial_no: number;
  batch_number: string;
  product_name?: string;
  product_sku?: string;
  quantity?: number;
  package_quantity?: number;
  uom?: string;
  warehouse_name?: string;
  storage_location_id?: string;
  storage_location?: string;
  print_count?: number;
  last_printed_at?: string | null;
}

export interface QrJob {
  id: EntityId;
  job_code: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  created_at?: string;
}

export interface QrLabelSize {
  widthMm: number;
  heightMm: number;
}

async function qrDataUrls(labels: QrLabel[]): Promise<string[]> {
  return Promise.all(
    labels.map((label) =>
      QRCode.toDataURL(label.qr_value, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
    )
  );
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-');
}

export async function createQrPdfBlob(labels: QrLabel[], job: QrJob): Promise<Blob> {
  if (labels.length === 0) return new Blob([], { type: 'application/pdf' });
  const images = await qrDataUrls(labels);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 8;
  const gap = 4;
  const cols = 3;
  const rows = 4;
  const cellWidth = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
  const cellHeight = (pageHeight - margin * 2 - gap * (rows - 1)) / rows;

  labels.forEach((label, index) => {
    const position = index % (cols * rows);
    if (index > 0 && position === 0) doc.addPage();
    const col = position % cols;
    const row = Math.floor(position / cols);
    const x = margin + col * (cellWidth + gap);
    const y = margin + row * (cellHeight + gap);

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cellWidth, cellHeight, 1.5, 1.5);

    const qrSize = 37;
    const qrX = x + (cellWidth - qrSize) / 2;
    const qrY = y + 4;
    doc.addImage(images[index], 'PNG', qrX, qrY, qrSize, qrSize);

    const payload = parseQrPayload(label.qr_value);
    const productName = label.product_name || payload?.product_name || job.product_name || '';
    const packageQuantity = label.package_quantity ?? payload?.package_quantity;
    const packageUnit = label.uom || payload?.uom || '';
    const bagCount = label.quantity ?? payload?.bag_count;
    const godown = label.warehouse_name || payload?.godown;
    const storageLocation = label.storage_location || payload?.storage_location;
    const textX = x + 3;
    const maxWidth = cellWidth - 6;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(String(productName).slice(0, 70), textX, qrY + qrSize + 4, {
      maxWidth,
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(51, 65, 85);
    doc.text(`Batch: ${label.batch_number}`, textX, qrY + qrSize + 8, { maxWidth });
    if (packageQuantity != null) {
      doc.text(`Package: ${packageQuantity} ${packageUnit} × ${bagCount || 1} bags`, textX, qrY + qrSize + 12, { maxWidth });
    }
    if (godown) {
      doc.text(`Godown: ${godown}${storageLocation ? ` · ${storageLocation}` : ''}`, textX, qrY + qrSize + 16, { maxWidth });
    }
    doc.setFontSize(5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Bag ${String(payload?.bag_serial ?? label.serial_no).padStart(4, '0')}`, textX, qrY + qrSize + 20, { maxWidth });
    doc.text(`QR ID: ${payload?.id || label.qr_value}`, textX, qrY + qrSize + 23, { maxWidth });
  });

  return doc.output('blob');
}

function parseQrPayload(value: string): Record<string, any> | null {
  try {
    const payload = JSON.parse(value);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export async function downloadQrPdf(labels: QrLabel[], job: QrJob): Promise<void> {
  if (labels.length === 0) return;
  const blob = await createQrPdfBlob(labels, job);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `QR-${safeFileName(job.job_code)}-${labels.length}-labels.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
