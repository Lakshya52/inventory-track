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
