/**
 * Operator-facing names for the three outcomes of recalling a QR/unit.
 *
 * The stored codes stay as DAMAGED / HOLD / RETURN_TO_STOCK so existing recall
 * records, API payloads and the backend's restock logic remain compatible —
 * only the words shown to the user are clearer here.
 */
export type RecallConditionCode = 'DAMAGED' | 'HOLD' | 'RETURN_TO_STOCK';

export const RECALL_CONDITIONS: ReadonlyArray<{
  value: RecallConditionCode;
  label: string;
  hint: string;
}> = [
  {
    value: 'DAMAGED',
    label: 'Damaged product — write off',
    hint: 'Bag is unusable. QR is blocked for good, stock is NOT returned — load a replacement.',
  },
  {
    value: 'HOLD',
    label: 'Tampered / suspect — hold for QA',
    hint: 'Keep it aside for inspection. QR is blocked, stock is NOT returned — load a replacement.',
  },
  {
    value: 'RETURN_TO_STOCK',
    label: 'Perfect condition — return to stock',
    hint: 'Bag is fine. QR is released for reuse and stock goes back — no replacement needed.',
  },
];

export function recallConditionLabel(value: string): string {
  return RECALL_CONDITIONS.find((item) => item.value === value)?.label ?? value;
}

export function recallConditionHint(value: string): string {
  return RECALL_CONDITIONS.find((item) => item.value === value)?.hint ?? '';
}
