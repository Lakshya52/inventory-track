/**
 * Minimal, dependency-free PDF writer for packing lists.
 *
 * The generated document is a valid PDF 1.4 file using the standard Helvetica
 * font, so it can be opened by any PDF reader and printed without relying on a
 * native binary or an extra npm package.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const BOTTOM_MARGIN = 50;
const DEFAULT_LINE_HEIGHT = 14;

type PdfLine = {
  text: string;
  size: number;
  spacing: number;
};

type PackingListData = Record<string, any>;

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

function wrapText(text: string, maxChars: number): string[] {
  const clean = toAscii(text);
  if (clean.length <= maxChars) return [clean];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function buildLines(data: PackingListData): PdfLine[] {
  const lines: PdfLine[] = [];
  const add = (text: string, size = 10, spacing = DEFAULT_LINE_HEIGHT): void => {
    const maxChars = size >= 16 ? 55 : size >= 12 ? 80 : 95;
    for (const wrapped of wrapText(text, maxChars)) {
      lines.push({ text: wrapped, size, spacing });
    }
  };
  const blank = (): void => {
    lines.push({ text: '', size: 10, spacing: 8 });
  };

  const client = data.client || {};
  const items: Record<string, any>[] = Array.isArray(data.items) ? data.items : [];

  add('PACKING LIST', 18, 26);
  add(`Order ID: ${display(data.order_id)}`, 11, 16);
  add(`Status: ${display(data.status)}`, 10);
  add(`Generated: ${formatDate(data.generated_at)}`, 10);
  blank();

  add('CLIENT', 12, 18);
  add(`Name: ${display(data.client_name ?? client.name)}`);
  add(`Contact: ${display(client.contact_person)}`);
  add(`Email: ${display(client.email)}`);
  add(`Phone: ${display(client.phone)}`);
  add(`Address: ${display(client.address)}`);
  add(`GST: ${display(client.gst_number)}`);
  blank();

  add('SHIPMENT', 12, 18);
  add(`Driver: ${display(data.driver_name)}`);
  add(`Driver Mobile: ${display(data.driver_phone)}`);
  add(`Vehicle: ${display(data.vehicle_number)}`);
  add(`Container: ${display(data.container_number)}`);
  add(`Seal Number: ${display(data.seal_number)}`);
  add(`Outcome: ${display(data.outcome)}`);
  add(`Raised By: ${display(data.raised_by_name)}`);
  add(`Approved By: ${display(data.approver_name)}`);
  add(`Dispatched By: ${display(data.dispatched_by)}`);
  add(`Dispatched At: ${formatDate(data.dispatched_at)}`);
  blank();

  add('PRODUCTS', 12, 18);
  if (items.length === 0) {
    add('No product lines were found for this dispatch order.');
  }
  items.forEach((item, index) => {
    const quantity = item.quantity === null || item.quantity === undefined || item.quantity === ''
      ? '-'
      : String(item.quantity);
    const uom = item.uom ? ` ${item.uom}` : '';
    const location = item.location ?? item.location_code ?? item.location_description ?? data.location;
    add(`Item ${index + 1}`, 11, 16);
    add(`Product: ${display(item.product_name)}`);
    if (item.sku) add(`SKU: ${display(item.sku)}`);
    add(`Batch Number: ${display(item.batch_number ?? data.batch_number)}`);
    add(`Quantity: ${quantity}${uom}`);
    add(`Shelf Location: ${display(location)}`);
    if (item.grade) add(`Grade: ${display(item.grade)}`);
    if (item.bag_quantity) {
      add(`Bag Quantity: ${display(item.bag_quantity)}${item.bag_quantity_unit ? ` ${display(item.bag_quantity_unit)}` : ''}`);
    }
    blank();
  });

  if (data.remarks) {
    add('REMARKS', 12, 18);
    add(display(data.remarks));
  }

  return lines;
}

function paginate(lines: PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let used = 0;
  const available = PAGE_HEIGHT - MARGIN - BOTTOM_MARGIN;

  for (const line of lines) {
    if (current.length > 0 && used + line.spacing > available) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += line.spacing;
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}

function pageContent(lines: PdfLine[], pageNumber: number, pageCount: number): string {
  const commands: string[] = ['BT'];
  let first = true;
  for (const line of lines) {
    if (first) {
      commands.push(`/F1 ${line.size} Tf`);
      commands.push(`${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`);
      first = false;
    } else {
      commands.push(`/F1 ${line.size} Tf`);
      commands.push(`0 -${line.spacing} Td`);
    }
    commands.push(`(${escapePdfText(line.text)}) Tj`);
  }

  // Footer with page numbering, drawn independently of the text flow above.
  commands.push('ET');
  commands.push('BT');
  commands.push('/F1 8 Tf');
  commands.push(`${MARGIN} ${BOTTOM_MARGIN - 15} Td`);
  commands.push(`(Page ${pageNumber} of ${pageCount}) Tj`);
  commands.push('ET');
  return commands.join('\n');
}

function assemblePdf(pages: PdfLine[][]): Buffer {
  const pageCount = pages.length;
  const pageObjectNumbers: number[] = [];
  let nextObject = 4;
  for (let index = 0; index < pageCount; index += 1) {
    pageObjectNumbers.push(nextObject);
    nextObject += 2;
  }

  const objects: string[] = [];
  const kids = pageObjectNumbers.map((number) => `${number} 0 R`).join(' ');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  pages.forEach((lines, index) => {
    const pageObject = pageObjectNumbers[index];
    const contentObject = pageObject + 1;
    const content = pageContent(lines, index + 1, pageCount);
    objects[pageObject] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`;
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
  return assemblePdf(paginate(buildLines(data || {})));
}
