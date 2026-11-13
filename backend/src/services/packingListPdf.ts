/**
 * Minimal, dependency-free PDF writer for packing lists.
 *
 * The generated document is a valid PDF 1.4 file using the standard Helvetica
 * fonts, so it can be opened by any PDF reader and printed without relying on a
 * native binary or an extra npm package.
 *
 * The layout mirrors the on-screen packing list modal: a title header, a
 * four-column summary grid and a bordered product table.
 */

const PAGE_WIDTH = 842; // A4 landscape
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const BOTTOM_LIMIT = PAGE_HEIGHT - 46;

type PackingListData = Record<string, any>;

type Column = {
  key: string;
  width: number;
  align?: 'left' | 'center';
};

const COLUMNS: Column[] = [
  { key: '#', width: 30, align: 'center' },
  { key: 'Grade', width: 178 },
  { key: 'SKU', width: 86 },
  { key: 'Batch Number', width: 112 },
  { key: 'Bags to Pick', width: 72 },
  { key: 'Storage Location', width: 150 },
  { key: 'QR Barcode', width: 142 },
];

const TABLE_WIDTH = COLUMNS.reduce((total, column) => total + column.width, 0);

// Colors as RGB triples in the 0..1 range.
const INK = [0.06, 0.09, 0.16];
const MUTED = [0.39, 0.45, 0.55];
const BORDER = [0.8, 0.84, 0.89];
const HEAD_BG = [0.89, 0.91, 0.94];
const META_BG = [0.97, 0.98, 0.99];
const ROW_ALT = [0.97, 0.98, 0.99];
const WHITE = [1, 1, 1];

/** PDF literal strings are ASCII-only here; replace anything else safely. */
function toAscii(value: unknown): string {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[^\x20-\x7E]/g, '?');
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function display(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return toAscii(value);
}

function formatDate(value: unknown): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return toAscii(value);
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function itemGradeName(item: any, data: PackingListData): string {
  return display(item.grade_name ?? item.grade ?? data.grade);
}

function gradeNames(data: PackingListData): string {
  const names = (Array.isArray(data.items) ? data.items : [])
    .map((item: any) => item.grade_name ?? item.grade ?? data.grade)
    .filter(Boolean);
  const unique = [...new Set(names.map((name) => String(name)))];
  return unique.join(', ') || display(data.grade);
}

function itemLocation(item: any, data: PackingListData): string {
  return display(item.location ?? item.location_code ?? item.location_description ?? data.location);
}

function itemBarcode(item: any, data: PackingListData): string {
  const ids: string[] = Array.isArray(item.qr_values) && item.qr_values.length
    ? item.qr_values.map((value: unknown) => String(value))
    : item.qr_value
      ? [String(item.qr_value)]
      : [];
  if (ids.length > 0) {
    const shown = ids.slice(0, 5);
    const suffix = ids.length > 5 ? ` +${ids.length - 5} more` : '';
    return `QR ID: ${shown.join(', ')}${suffix}`;
  }
  return display(item.barcode ?? data.barcode);
}

/** Approximate text width for the built-in Helvetica fonts. */
function textWidth(text: string, size: number, bold = false): number {
  return text.length * size * (bold ? 0.55 : 0.5);
}

function wrapText(text: string, maxChars: number): string[] {
  const clean = toAscii(text).trim();
  if (!clean) return [''];
  if (clean.length <= maxChars) return [clean];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (let word of words) {
    while (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function fitLines(value: string, maxChars: number, maxLines = 2): string[] {
  const lines = wrapText(value, maxChars);
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, maxLines);
  trimmed[maxLines - 1] = `${trimmed[maxLines - 1].slice(0, Math.max(0, maxChars - 3))}...`;
  return trimmed;
}

function color(rgb: number[]): string {
  return `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
}

function textAt(x: number, top: number, text: string, size: number, bold = false, rgb: number[] = INK): string {
  const baseline = PAGE_HEIGHT - top - size * 0.8;
  return `BT ${color(rgb)} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${baseline.toFixed(2)} Td (${escapePdfText(text)}) Tj ET`;
}

function rect(x: number, top: number, width: number, height: number, fill?: number[], stroke?: number[]): string {
  const y = PAGE_HEIGHT - top - height;
  let command = '';
  if (fill) command += `${color(fill)} rg `;
  if (stroke) command += `${color(stroke)} RG `;
  command += `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re `;
  command += fill && stroke ? 'B' : fill ? 'f' : 'S';
  return command;
}

function line(x1: number, top1: number, x2: number, top2: number, width = 0.6, rgb: number[] = BORDER): string {
  const y1 = PAGE_HEIGHT - top1;
  const y2 = PAGE_HEIGHT - top2;
  return `${color(rgb)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function buildDocument(data: PackingListData): string[][] {
  const items: Record<string, any>[] = Array.isArray(data.items) ? data.items : [];
  const pages: string[][] = [];
  let current: string[] = [];
  let cursor = MARGIN;

  const beginPage = (): void => {
    current = [];
    pages.push(current);
    cursor = MARGIN;
  };

  const drawMeta = (): void => {
    const x = MARGIN;
    const width = PAGE_WIDTH - MARGIN * 2;
    const rowHeight = 42;
    const columnWidth = width / 4;
    const container = display(data.container_number);
    const seal = data.seal_number ? toAscii(data.seal_number) : 'Awaiting Loading';
    const rows: Array<Array<[string, string]>> = [
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

    const totalHeight = rowHeight * rows.length;
    current.push(rect(x, cursor, width, totalHeight, META_BG, BORDER));

    rows.forEach((row, rowIndex) => {
      row.forEach(([label, value], columnIndex) => {
        const cellX = x + columnIndex * columnWidth + 9;
        const cellTop = cursor + rowIndex * rowHeight + 7;
        current.push(textAt(cellX, cellTop, label.toUpperCase(), 6.5, true, MUTED));
        const maxChars = Math.max(8, Math.floor((columnWidth - 18) / (8.5 * 0.5)));
        fitLines(value, maxChars).forEach((lineText, lineIndex) => {
          current.push(textAt(cellX, cellTop + 11 + lineIndex * 10, lineText, 8.5, true, INK));
        });
      });
    });

    for (let column = 1; column < 4; column += 1) {
      const dividerX = x + column * columnWidth;
      current.push(line(dividerX, cursor, dividerX, cursor + totalHeight, 0.6, BORDER));
    }
    current.push(line(x, cursor + rowHeight, x + width, cursor + rowHeight, 0.6, BORDER));
    cursor += totalHeight;
  };

  const drawTableHeader = (): void => {
    const height = 22;
    current.push(rect(MARGIN, cursor, TABLE_WIDTH, height, HEAD_BG, BORDER));
    let cellX = MARGIN;
    for (const column of COLUMNS) {
      const label = column.key.toUpperCase();
      const labelWidth = textWidth(label, 7.5, true);
      const textX = column.align === 'center' ? cellX + (column.width - labelWidth) / 2 : cellX + 6;
      current.push(textAt(textX, cursor + 6, label, 7.5, true, [0.2, 0.25, 0.33]));
      cellX += column.width;
    }
    let dividerX = MARGIN;
    for (let index = 0; index < COLUMNS.length - 1; index += 1) {
      dividerX += COLUMNS[index].width;
      current.push(line(dividerX, cursor, dividerX, cursor + height, 0.6, BORDER));
    }
    cursor += height;
  };

  const rowHeightFor = (cells: string[]): number => {
    let maxLines = 1;
    cells.forEach((cell, index) => {
      const column = COLUMNS[index];
      const maxChars = Math.max(4, Math.floor((column.width - 12) / (7.5 * 0.5)));
      maxLines = Math.max(maxLines, wrapText(cell, maxChars).length);
    });
    return Math.max(20, maxLines * 10 + 9);
  };

  const drawRow = (cells: string[], rowHeight: number, alternate: boolean): void => {
    current.push(rect(MARGIN, cursor, TABLE_WIDTH, rowHeight, alternate ? ROW_ALT : WHITE));
    let cellX = MARGIN;
    cells.forEach((cell, index) => {
      const column = COLUMNS[index];
      const maxChars = Math.max(4, Math.floor((column.width - 12) / (7.5 * 0.5)));
      wrapText(cell, maxChars).forEach((lineText, lineIndex) => {
        const lineWidth = textWidth(lineText, 7.5, index === 0);
        const textX = column.align === 'center' ? cellX + (column.width - lineWidth) / 2 : cellX + 6;
        current.push(textAt(textX, cursor + 6 + lineIndex * 10, lineText, 7.5, index === 0, INK));
      });
      cellX += column.width;
    });
    current.push(line(MARGIN, cursor + rowHeight, MARGIN + TABLE_WIDTH, cursor + rowHeight, 0.6, BORDER));
    cursor += rowHeight;
  };

  // ---- Page 1 header ------------------------------------------------------
  beginPage();
  current.push(textAt(MARGIN, cursor, 'PACKING LIST', 22, true, INK));
  current.push(textAt(MARGIN, cursor + 30, 'Aceone Inventory & Product Scanning System', 9, false, MUTED));

  const orderDisplay = data.order_number ?? data.order_id;
  const orderText = `Order #${display(orderDisplay)}`;
  current.push(textAt(PAGE_WIDTH - MARGIN - textWidth(orderText, 11, true), cursor + 2, orderText, 11, true, INK));

  const generatedText = `Generated: ${formatDate(data.generated_at)}`;
  current.push(textAt(PAGE_WIDTH - MARGIN - textWidth(generatedText, 8), cursor + 22, generatedText, 8, false, MUTED));

  cursor += 46;
  current.push(line(MARGIN, cursor, PAGE_WIDTH - MARGIN, cursor, 2, INK));
  cursor += 14;

  drawMeta();
  cursor += 16;
  drawTableHeader();

  // ---- Product rows -------------------------------------------------------
  if (items.length === 0) {
    const height = 40;
    current.push(rect(MARGIN, cursor, TABLE_WIDTH, height, WHITE));
    current.push(textAt(MARGIN + TABLE_WIDTH / 2 - textWidth('No product lines were found for this packing list.', 9) / 2, cursor + 14, 'No product lines were found for this packing list.', 9, false, MUTED));
    current.push(line(MARGIN, cursor + height, MARGIN + TABLE_WIDTH, cursor + height, 0.6, BORDER));
    cursor += height;
  } else {
    items.forEach((item, index) => {
      const quantity = item.quantity === null || item.quantity === undefined || item.quantity === '' ? '-' : String(item.quantity);
      const cells = [
        String(index + 1),
        itemGradeName(item, data),
        display(item.sku),
        display(item.batch_number ?? data.batch_number),
        quantity,
        itemLocation(item, data),
        itemBarcode(item, data),
      ];
      const rowHeight = rowHeightFor(cells);

      if (cursor + rowHeight > BOTTOM_LIMIT) {
        beginPage();
        current.push(textAt(MARGIN, cursor, `PACKING LIST - Order #${display(orderDisplay)} (continued)`, 11, true, INK));
        cursor += 22;
        drawTableHeader();
      }
      drawRow(cells, rowHeight, index % 2 === 1);
    });
  }

  // ---- Page footers -------------------------------------------------------
  const pageCount = pages.length;
  pages.forEach((page, index) => {
    const footer = `Page ${index + 1} of ${pageCount}`;
    page.push(line(MARGIN, PAGE_HEIGHT - 40, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 40, 0.6, BORDER));
    page.push(textAt((PAGE_WIDTH - textWidth(footer, 7.5)) / 2, PAGE_HEIGHT - 32, footer, 7.5, false, MUTED));
    page.push(textAt(MARGIN, PAGE_HEIGHT - 32, 'Generated by Aceone Inventory & Product Scanning System', 7.5, false, MUTED));
  });

  return pages;
}

function pageContent(commands: string[]): string {
  return commands.join('\n');
}

function assemblePdf(pages: string[][]): Buffer {
  const pageCount = pages.length;
  const pageObjectNumbers: number[] = [];
  let nextObject = 6;
  for (let index = 0; index < pageCount; index += 1) {
    pageObjectNumbers.push(nextObject);
    nextObject += 2;
  }

  const objects: string[] = [];
  const kids = pageObjectNumbers.map((number) => `${number} 0 R`).join(' ');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pages.forEach((commands, index) => {
    const pageObject = pageObjectNumbers[index];
    const contentObject = pageObject + 1;
    const content = pageContent(commands);
    objects[pageObject] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] =
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });

  const maxObject = nextObject - 1;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let objectNumber = 1; objectNumber <= maxObject; objectNumber += 1) {
    offsets[objectNumber] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${maxObject + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let objectNumber = 1; objectNumber <= maxObject; objectNumber += 1) {
    pdf += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export function buildPackingListPdf(data: PackingListData): Buffer {
  return assemblePdf(buildDocument(data || {}));
}
