import type { EntityId } from "../types";

/** One physical unit batch (a single bag) that can be put on the truck. */
export type BatchUnit = {
	id: string;
	available: number;
	location: string;
	batchNumber: string;
};

/**
 * A product inside a batch. Every unit batch of the same product inside the
 * same batch group collapses into one line, so the same product is never
 * listed once per bag.
 */
export type ProductLine = {
	key: string;
	productKey: string;
	name: string;
	grade: string;
	sku: string;
	locations: string[];
	available: number;
	units: BatchUnit[];
};

/** A batch group (one dispatch batch). Holds the FAQ of its product lines. */
export type BatchGroup = {
	key: string;
	batchNumber: string;
	lines: ProductLine[];
	available: number;
	unitCount: number;
};

export function availableFor(batch: any): number {
	return Number(
		batch.available_quantity ??
			Math.max(
				0,
				Number(batch.quantity) -
					Number(batch.reserved_quantity || 0) -
					Number(batch.recalled_quantity || 0),
			),
	);
}

/**
 * Groups the unit batches into dispatch batches, and each dispatch batch into
 * one line per product. The unit batches stay one bag each, but the list the
 * user sees shows a product once instead of once per bag.
 */
export function buildBatchGroups(rows: any[]): BatchGroup[] {
	const groups = new Map<string, BatchGroup>();
	const lineIndex = new Map<string, Map<string, ProductLine>>();

	for (const row of rows) {
		const available = availableFor(row);
		if (available <= 0) continue;

		const batchKey = String(row.parent_batch_number || row.batch_number || row.id);
		let group = groups.get(batchKey);
		if (!group) {
			group = {
				key: batchKey,
				batchNumber: batchKey,
				lines: [],
				available: 0,
				unitCount: 0,
			};
			groups.set(batchKey, group);
			lineIndex.set(batchKey, new Map());
		}

		const lines = lineIndex.get(batchKey)!;
		const productKey = String(
			row.product_id ??
				`${row.product_name ?? ""}|${row.product_grade ?? row.grade_name ?? ""}`,
		);
		let line = lines.get(productKey);
		if (!line) {
			line = {
				key: `${batchKey}::${productKey}`,
				productKey,
				name: String(row.product_name ?? ""),
				grade: String(row.product_grade ?? row.grade_name ?? ""),
				sku: String(row.product_sku ?? ""),
				locations: [],
				available: 0,
				units: [],
			};
			lines.set(productKey, line);
			group.lines.push(line);
		}

		const location = String(row.storage_location ?? "");
		if (location && !line.locations.includes(location)) line.locations.push(location);
		line.available += available;
		line.units.push({
			id: String(row.id),
			available,
			location,
			batchNumber: String(row.batch_number ?? ""),
		});
		group.available += available;
		group.unitCount += 1;
	}

	return [...groups.values()].sort((a, b) =>
		a.batchNumber < b.batchNumber ? 1 : a.batchNumber > b.batchNumber ? -1 : 0,
	);
}

/**
 * Turns the selected product lines back into the per-unit items the dispatch
 * order API expects. Each unit batch owns one QR label, so it has to be
 * reserved on its own row.
 */
export function expandSelectedLines(
	lines: ProductLine[],
	quantities: Record<string, number>,
): Array<{ batch_id: EntityId; quantity: number }> {
	const items: Array<{ batch_id: EntityId; quantity: number }> = [];
	for (const line of lines) {
		let remaining = Number(quantities[line.key] || 0);
		for (const unit of line.units) {
			if (remaining <= 0) break;
			const take = Math.min(remaining, unit.available);
			if (take <= 0) continue;
			items.push({ batch_id: unit.id as EntityId, quantity: take });
			remaining -= take;
		}
	}
	return items;
}
