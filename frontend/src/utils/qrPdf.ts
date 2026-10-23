import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

export interface QrLabel {
  id: number;
  qr_value: string;
  serial_no: number;
  batch_number: string;
  print_count?: number;
  last_printed_at?: string | null;
}

export interface QrJob {
  id: number;
  job_code: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  created_at?: string;
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

export async function downloadQrPdf(labels: QrLabel[], job: QrJob): Promise<void> {
  if (labels.length === 0) return;
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

    const textX = x + 3;
    const maxWidth = cellWidth - 6;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(String(job.product_name || '').slice(0, 70), textX, qrY + qrSize + 5, {
      maxWidth,
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    doc.text(`Batch: ${label.batch_number}`, textX, qrY + qrSize + 10, { maxWidth });

    doc.setFontSize(6);
    doc.setTextColor(100, 116, 139);
    doc.text(`Unit ${String(label.serial_no).padStart(4, '0')}`, textX, qrY + qrSize + 14, { maxWidth });
    doc.text(label.qr_value, textX, qrY + qrSize + 18, { maxWidth });
  });

  doc.save(`QR-${safeFileName(job.job_code)}-${labels.length}-labels.pdf`);
}

export async function printQrLabels(labels: QrLabel[], job: QrJob): Promise<void> {
  if (labels.length === 0) return;
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Allow pop-ups to print QR labels');
  }
  const images = await qrDataUrls(labels);
  const cards = labels.map((label, index) => `
    <div class="qr-card">
      <div class="product">${escapeHtml(job.product_name)}</div>
      <div class="batch">${escapeHtml(label.batch_number)} — Unit ${String(label.serial_no).padStart(4, '0')}</div>
      <img src="${images[index]}" width="150" height="150" />
      <div class="label">${escapeHtml(label.qr_value)}</div>
    </div>
  `).join('');

  win.document.write(`
    <html>
      <head>
        <title>QR Labels - ${escapeHtml(job.job_code)}</title>
        <style>
          @page { margin: 8mm; }
          body { font-family: Arial, sans-serif; display: flex; flex-wrap: wrap; gap: 8mm; justify-content: flex-start; padding: 0; margin: 0; }
          .qr-card { width: 60mm; min-height: 64mm; border: 1px dashed #cbd5e1; padding: 3mm; box-sizing: border-box; text-align: center; page-break-inside: avoid; }
          .qr-card img { display: block; margin: 1mm auto; }
          .product { font-size: 10px; font-weight: 700; color: #0f172a; }
          .batch { font-size: 9px; color: #334155; margin: 1mm 0; }
          .label { font-size: 7px; color: #64748b; word-break: break-all; }
          @media print { .qr-card { border: none; } }
        </style>
      </head>
      <body>
        ${cards}
        <script>window.onload = function() { window.print(); window.close(); };<\/script>
      </body>
    </html>
  `);
  win.document.close();
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
