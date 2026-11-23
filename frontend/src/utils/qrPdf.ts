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

    const qrSize = 30;
    const qrX = x + (cellWidth - qrSize) / 2;
    const qrY = y + 3;
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
    const bigValueY = qrY + qrSize + 5.6;
    // The raw QR value is the most important thing on the label, so it goes
    // directly below the code in large bold type.
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    // Shrink the big value line just enough to keep the full raw value on one line.
    let bigFontSize = 12;
    doc.setFontSize(bigFontSize);
    while (bigFontSize > 5 && doc.getTextWidth(String(label.qr_value)) > maxWidth) {
      bigFontSize -= 0.5;
      doc.setFontSize(bigFontSize);
    }
    doc.text(String(label.qr_value), x + cellWidth / 2, bigValueY, {
      align: 'center',
      maxWidth,
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(String(productName).slice(0, 70), textX, bigValueY + 5.2, {
      maxWidth,
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(51, 65, 85);
    doc.text(`Batch: ${label.batch_number}`, textX, bigValueY + 9.2, { maxWidth });
    if (packageQuantity != null) {
      doc.text(`Package: ${packageQuantity} ${packageUnit} × ${bagCount || 1} bags`, textX, bigValueY + 13.2, { maxWidth });
    }
    if (godown) {
      doc.text(`Godown: ${godown}${storageLocation ? ` · ${storageLocation}` : ''}`, textX, bigValueY + 17.2, { maxWidth });
    }
    doc.setFontSize(5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Bag ${String(payload?.bag_serial ?? label.serial_no).padStart(4, '0')}`, textX, y + cellHeight - 3.2, { maxWidth });
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

/**
 * One page per label at the physical label size. Used for direct printing:
 * QZ Tray sends the whole document to the printer as a single Windows job.
 */
export async function createQrLabelPdfBlob(
  labels: QrLabel[],
  job: QrJob,
  size: QrLabelSize,
): Promise<Blob> {
  if (labels.length === 0) return new Blob([], { type: 'application/pdf' });
  const width = Math.max(30, Math.min(200, Math.round(size.widthMm || 60)));
  const height = Math.max(30, Math.min(250, Math.round(size.heightMm || 64)));
  const images = await qrDataUrls(labels);
  const doc = new jsPDF({ unit: 'mm', format: [width, height], orientation: 'portrait' });
  const margin = Math.max(1.5, Math.min(width, height) * 0.05);
  const qrSize = Math.min(width - margin * 2, (height - margin * 2) * 0.55);

  labels.forEach((label, index) => {
    if (index > 0) doc.addPage([width, height], 'portrait');
    const payload = parseQrPayload(label.qr_value);
    const productName = label.product_name || payload?.product_name || job.product_name || '';
    const packageQuantity = label.package_quantity ?? payload?.package_quantity;
    const packageUnit = label.uom || payload?.uom || '';
    const bagCount = label.quantity ?? payload?.bag_count;
    const godown = label.warehouse_name || payload?.godown;
    const storageLocation = label.storage_location || payload?.storage_location;

    doc.addImage(images[index], 'PNG', (width - qrSize) / 2, margin, qrSize, qrSize);

    const maxWidth = width - margin * 2;
    let y = margin + qrSize + 2.5;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    let valueFont = 8;
    doc.setFontSize(valueFont);
    while (valueFont > 3 && doc.getTextWidth(String(label.qr_value)) > maxWidth) {
      valueFont -= 0.5;
      doc.setFontSize(valueFont);
    }
    doc.text(String(label.qr_value), width / 2, y, { align: 'center', maxWidth });
    y += 3.5;

    const line = (text: string, font = 5, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(font);
      doc.setTextColor(bold ? 15 : 71, bold ? 23 : 85, bold ? 42 : 105);
      doc.text(text, margin, y, { maxWidth });
      y += Math.max(2.4, font * 0.45);
    };
    line(String(productName).slice(0, 80), 5, true);
    line(`Batch: ${label.batch_number}`, 4.2);
    if (packageQuantity != null) line(`Package: ${packageQuantity} ${packageUnit} × ${bagCount || 1} bags`, 4.2);
    if (godown) line(`Godown: ${godown}${storageLocation ? ` · ${storageLocation}` : ''}`, 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4);
    doc.setTextColor(100, 116, 139);
    doc.text(`Bag ${String(payload?.bag_serial ?? label.serial_no).padStart(4, '0')}`, margin, Math.min(height - margin, y + 1), { maxWidth });
  });

  return doc.output('blob');
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
