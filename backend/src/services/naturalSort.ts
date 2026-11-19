/**
 * Natural ("alphanumeric") comparison: embedded digit runs compare as numbers,
 * so "TPR D1 P9" < "TPR D1 P89" < "TPR D1 P90" (instead of the plain string
 * order "P89" < "P9"). Case-insensitive, with a final length fallback for
 * deterministic output.
 */
export function naturalCompare(a: string, b: string): number {
  const chunk = (input: string) => input.toLowerCase().match(/(\d+|\D+)/g) ?? [];
  const partsA = chunk(String(a ?? ''));
  const partsB = chunk(String(b ?? ''));
  const shared = Math.min(partsA.length, partsB.length);
  for (let index = 0; index < shared; index += 1) {
    const left = partsA[index];
    const right = partsB[index];
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff;
      continue; // same number, different padding ("01" vs "1") — fall through to next chunk
    }
    const diff = left.localeCompare(right);
    if (diff !== 0) return diff;
  }
  return partsA.length - partsB.length;
}

/** Sorts rows in place by the given accessor using naturalCompare (grades, names, SKUs). */
export function naturalSortBy<T>(rows: T[], ...accessors: Array<(row: T) => string>): T[] {
  return rows.sort((a, b) => {
    for (const accessor of accessors) {
      const diff = naturalCompare(accessor(a), accessor(b));
      if (diff !== 0) return diff;
    }
    return 0;
  });
}
