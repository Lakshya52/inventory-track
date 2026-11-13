/**
 * Renders a dispatch order's human-readable number (DO-<YYYY>-<n>) with the
 * legacy raw id as a fallback for older data.
 */
export function orderNumber(
  data: {
    order_number?: string | null;
    order_id?: string | number | null;
    id?: string | number | null;
  } | null | undefined,
): string {
  if (!data) return '-';
  if (data.order_number) return String(data.order_number);
  const id = data.order_id ?? data.id;
  return id === undefined || id === null ? '-' : String(id);
}
