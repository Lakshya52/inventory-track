/**
 * Unit batch numbers are built as `<SKU>-<YYYYMMDD>-<group>-<line>-<unit>`.
 * When the product row behind a batch no longer exists (legacy batches whose
 * product was deleted), the SKU is still recoverable from the batch number.
 */
export function skuFromBatchNumber(batchNumber: string | null | undefined): string | null {
	if (!batchNumber) return null;
	const parts = String(batchNumber).split('-');
	const dateIndex = parts.findIndex((part) => /^\d{8}$/.test(part));
	if (dateIndex <= 0) return null;
	return parts.slice(0, dateIndex).join('-');
}

export function buildBatchNumbers(baseBatchNumber: string, batchCount: number): string[] {
  const match = /^(.*-)(\d+)$/.exec(baseBatchNumber);
  if (!match) {
    if (batchCount === 1) return [baseBatchNumber];
    return Array.from({ length: batchCount }, (_, index) => `${baseBatchNumber}-${String(index + 1).padStart(3, '0')}`);
  }

  const [, prefix, firstSequence] = match;
  const width = firstSequence.length;
  const start = Number(firstSequence);
  return Array.from({ length: batchCount }, (_, index) => `${prefix}${String(start + index).padStart(width, '0')}`);
}
