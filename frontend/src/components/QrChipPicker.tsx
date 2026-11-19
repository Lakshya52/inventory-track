import { useMemo } from "react";
import { Check, Plus, X } from "lucide-react";

/** One pickable QR label, as returned by /dispatch-orders/available-qr-labels. */
export type QrLabelChip = {
	id: number | string;
	batch_id: number | string;
	qr_value: string;
	serial_no: number;
};

type Props = {
	/** All available labels for the line (already flattened over its unit batches). */
	labels: QrLabelChip[];
	/** Ids of the labels currently picked for the order. */
	selectedIds: string[];
	onToggle: (labelId: string) => void;
	onSelectAll: () => void;
	onClear: () => void;
	/** Show a slimmer header for dense review lists (e.g. step 3). */
	compact?: boolean;
	/** True when the label fetch failed (distinct from a genuinely empty list). */
	loadError?: boolean;
};

/**
 * Displays every available QR code of a line as a clickable chip. Clicking a
 * chip adds (or removes) that exact QR code from the dispatch order, so the
 * order reserves precisely the physical bags the picker chose.
 */
export default function QrChipPicker({
	labels,
	selectedIds,
	onToggle,
	onSelectAll,
	onClear,
	compact = false,
	loadError = false,
}: Props) {
	const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

	if (labels.length === 0) {
		return (
			<p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
				{loadError
					? "Could not load the QR codes for this line. Refresh the page and try again."
					: "No printed, unassigned QR codes are available for this line. Print the labels first, or free a reserved one by cancelling its order."}
			</p>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-bold uppercase tracking-wide text-surface-500">
					QR codes · <strong className="tabular-nums text-surface-900">{selected.size}</strong>
					<span className="text-surface-400"> / {labels.length} picked</span>
				</span>
				<span className="flex items-center gap-1 text-[11px] font-bold">
					<button
						type="button"
						onClick={onSelectAll}
						disabled={selected.size === labels.length}
						className="cursor-pointer rounded-md px-2 py-1 text-brand-600 transition hover:bg-brand-50 disabled:cursor-default disabled:text-surface-300 disabled:hover:bg-transparent"
					>
						Select all
					</button>
					<button
						type="button"
						onClick={onClear}
						disabled={selected.size === 0}
						className="cursor-pointer rounded-md px-2 py-1 text-surface-500 transition hover:bg-surface-100 disabled:cursor-default disabled:text-surface-300 disabled:hover:bg-transparent"
					>
						Clear
					</button>
				</span>
			</div>
			<div
				className={`flex flex-wrap gap-2 overflow-y-auto rounded-lg border border-surface-200 bg-surface-50/60 p-2.5 ${
					compact ? "max-h-36" : "max-h-48"
				}`}
			>
				{labels.map((label) => {
					const id = String(label.id);
					const picked = selected.has(id);
					return (
						<button
							key={id}
							type="button"
							onClick={() => onToggle(id)}
							aria-pressed={picked}
							title={picked ? `Remove QR ${label.qr_value} from the order` : `Add QR ${label.qr_value} to the order`}
							className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-4 py-2 font-mono text-xs leading-none transition ${
								picked
									? "border-brand-600 bg-brand-600 font-bold text-white shadow-sm"
									: "border-surface-200 bg-white text-surface-700 hover:border-brand-400 hover:text-brand-700"
							}`}
						>
							{picked ? <Check size={13} strokeWidth={3} /> : <Plus size={13} strokeWidth={3} />}
							{label.qr_value}
						</button>
					);
				})}
			</div>
			{!compact && (
				<p className="flex items-center gap-1 text-[11px] text-surface-400">
					<X size={11} />
					Click a chip to add or remove that exact QR code from this order.
				</p>
			)}
		</div>
	);
}
