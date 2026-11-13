import { jsPDF } from 'jspdf';
import { formatDateTime } from './dateFormat';

/**
 * Client-side packing list PDF that mirrors the on-screen modal / print layout:
 * a title header, a four-column summary grid and a bordered product table.
 */

const PAGE_WIDTH = 297; // A4 landscape, mm
const PAGE_HEIGHT = 210;
const MARGIN = 10;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - 12;

type Column = { label: string; width: number; align?: 'left' | 'center' };

const COLUMNS: Column[] = [
  { label: '#', width: 8, align: 'center' },
  { label: 'Grade', width: 62 },
  { label: 'SKU', width: 28 },
  { label: 'Batch Number', width: 40 },
  { label: 'Bags to Pick', width: 25 },
  { label: 'Storage Location', width: 60 },
  { label: 'QR Barcode', width: 54 },
];

const TABLE_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0);

function display(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function itemGradeName(item: any, data: any): string {
  return display(item.grade_name ?? item.grade ?? data.grade);
}

function gradeNames(data: any): string {
  const names = (data.items || [])
    .map((item: any) => item.grade_name ?? item.grade ?? data.grade)
    .filter(Boolean);
  const unique = [...new Set(names.map((name: any) => String(name)))];
  return unique.join(', ') || display(data.grade);
}

function itemLocation(item: any, data: any): string {
  return display(item.location ?? item.location_code ?? item.location_description ?? data.location);
}

function itemQrIds(item: any): string[] {
  if (Array.isArray(item.qr_values) && item.qr_values.length) {
    return item.qr_values.map((value: unknown) => String(value));
  }
  if (item.qr_value) return [String(item.qr_value)];
  return [];
}

function itemBarcode(item: any, data: any): string {
  const ids = itemQrIds(item);
  if (ids.length > 0) {
    const shown = ids.slice(0, 5);
    const suffix = ids.length > 5 ? ` +${ids.length - 5} more` : '';
    return `QR ID: ${shown.join(', ')}${suffix}`;
  }
  return display(item.barcode ?? data.barcode);
}

export function createPackingListPdfBlob(data: any): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const items: any[] = Array.isArray(data.items) ? data.items : [];

  const drawTableHeader = (top: number): number => {
    doc.setFillColor(226, 232, 240);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN, top, TABLE_WIDTH, 8, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(51, 65, 85);
    let cellX = MARGIN;
    for (const column of COLUMNS) {
      const textX = column.align === 'center' ? cellX + column.width / 2 : cellX + 2;
      doc.text(column.label.toUpperCase(), textX, top + 2.5, {
        baseline: 'top',
        align: column.align === 'center' ? 'center' : 'left',
      });
      cellX += column.width;
    }

    doc.setDrawColor(203, 213, 225);
    let dividerX = MARGIN;
    for (let index = 0; index < COLUMNS.length - 1; index += 1) {
      dividerX += COLUMNS[index].width;
      doc.line(dividerX, top, dividerX, top + 8);
    }
    return top + 8;
  };

  // ---- Header -------------------------------------------------------------
  let y = MARGIN;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text('PACKING LIST', MARGIN, y, { baseline: 'top' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Aceone Inventory & Product Scanning System', MARGIN, y + 8.5, { baseline: 'top' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Order #${display(data.order_id)}`, PAGE_WIDTH - MARGIN, y, { baseline: 'top', align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${formatDateTime(data.generated_at)}`, PAGE_WIDTH - MARGIN, y + 6, {
    baseline: 'top',
    align: 'right',
  });

  y += 15;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 4;

  // ---- Summary grid -------------------------------------------------------
  const metaRowHeight = 15;
  const metaColumnWidth = CONTENT_WIDTH / 4;
  const container = display(data.container_number);
  const seal = data.seal_number ? String(data.seal_number) : 'Awaiting Loading';
  const metaRows: Array<Array<[string, string]>> = [
    [
      ['Client', display(data.client_name)],
      ['Grade', gradeNames(data)],
      ['Batch Number', display(data.batch_number)],
    ],
    [
      ['Transporter', display(data.driver_name)],
      ['Transporter Mobile', display(data.driver_phone)],
      ['Vehicle', display(data.vehicle_number)],
      ['Container / Seal', `${container} / ${seal}`],
    ],
  ];

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, CONTENT_WIDTH, metaRowHeight * metaRows.length, 'FD');

  metaRows.forEach((row, rowIndex) => {
    row.forEach(([label, value], columnIndex) => {
      const cellX = MARGIN + columnIndex * metaColumnWidth + 3;
      const cellTop = y + rowIndex * metaRowHeight + 2.5;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139);
      doc.text(label.toUpperCase(), cellX, cellTop, { baseline: 'top' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      const lines = doc.splitTextToSize(value, metaColumnWidth - 6).slice(0, 2);
      lines.forEach((lineText: string, lineIndex: number) => {
        doc.text(lineText, cellX, cellTop + 4 + lineIndex * 3.4, { baseline: 'top' });
      });
    });
  });

  doc.setDrawColor(203, 213, 225);
  for (let column = 1; column < 4; column += 1) {
    const dividerX = MARGIN + column * metaColumnWidth;
    doc.line(dividerX, y, dividerX, y + metaRowHeight * metaRows.length);
  }
  doc.line(MARGIN, y + metaRowHeight, MARGIN + CONTENT_WIDTH, y + metaRowHeight);

  y += metaRowHeight * metaRows.length + 5;

  // ---- Product table ------------------------------------------------------
  y = drawTableHeader(y);

  const drawRow = (cells: string[], top: number, rowHeight: number, alternate: boolean): void => {
    if (alternate) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, top, TABLE_WIDTH, rowHeight, 'F');
    }

    let cellX = MARGIN;
    cells.forEach((cell, columnIndex) => {
      const column = COLUMNS[columnIndex];
      doc.setFont('helvetica', columnIndex === 0 ? 'bold' : 'normal');
      doc.setFontSize(7);
      doc.setTextColor(30, 41, 59);
      const width = column.width - 3;
      const lines = doc.splitTextToSize(cell, width);
      const align = column.align === 'center' ? 'center' : 'left';
      const textX = column.align === 'center' ? cellX + column.width / 2 : cellX + 2;
      lines.forEach((lineText: string, lineIndex: number) => {
        doc.text(lineText, textX, top + 2 + lineIndex * 3.4, { baseline: 'top', align });
      });
      cellX += column.width;
    });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, top + rowHeight, MARGIN + TABLE_WIDTH, top + rowHeight);
  };

  const rowHeightFor = (cells: string[]): number => {
    let maxLines = 1;
    cells.forEach((cell, index) => {
      const lines = doc.splitTextToSize(cell, COLUMNS[index].width - 3);
      maxLines = Math.max(maxLines, lines.length);
    });
    return Math.max(7, maxLines * 3.6 + 2.4);
  };

  if (items.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('No product lines were found for this packing list.', MARGIN + TABLE_WIDTH / 2, y + 4, {
      baseline: 'top',
      align: 'center',
    });
    doc.setDrawColor(226, 232, 240);
    doc.line(MARGIN, y + 12, MARGIN + TABLE_WIDTH, y + 12);
    y += 12;
  } else {
    items.forEach((item, index) => {
      const quantity = item.quantity === null || item.quantity === undefined || item.quantity === ''
        ? '-'
        : String(item.quantity);
      const cells = [
        String(index + 1),
        display(itemGradeName(item, data)),
        display(item.sku),
        display(item.batch_number ?? data.batch_number),
        quantity,
        itemLocation(item, data),
        itemBarcode(item, data),
      ];
      const rowHeight = rowHeightFor(cells);

      if (y + rowHeight > BOTTOM_LIMIT) {
        doc.addPage();
        y = MARGIN;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.text(`PACKING LIST - Order #${display(data.order_id)} (continued)`, MARGIN, y, { baseline: 'top' });
        y += 6;
        y = drawTableHeader(y);
      }

      drawRow(cells, y, rowHeight, index % 2 === 1);
      y += rowHeight;
    });
  }

  // ---- Footers ------------------------------------------------------------
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_HEIGHT - 10, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Generated by Aceone Inventory & Product Scanning System', MARGIN, PAGE_HEIGHT - 8, {
      baseline: 'top',
    });
    doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 8, {
      baseline: 'top',
      align: 'right',
    });
  }

  return doc.output('blob');
}
