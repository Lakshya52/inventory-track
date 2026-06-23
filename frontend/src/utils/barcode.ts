// QR code format: QR:{SKU}:{BATCH_ID}
export function parseQRCode(value: string) {
  const parts = value.split(':');
  if (parts.length === 3 && parts[0] === 'QR') {
    return { sku: parts[1], batchId: parts[2] };
  }
  // Fallback: treat entire value as a raw identifier
  return { sku: '', batchId: value };
}
