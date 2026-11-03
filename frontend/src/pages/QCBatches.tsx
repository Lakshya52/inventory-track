import { useEffect, useMemo, useState } from "react";
import {
	Boxes,
	Minus,
	Plus,
	Printer,
	Trash2,
	PackagePlus,
	X,
	Search,
} from "lucide-react";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
	prepareDirectQrPrinter,
	printQrLabelsDirect,
} from "../utils/directQrPrinter";

type Line = { productId: string; quantity: string; shelfLocationId: string };
type Warehouse = { id: string; name: string; racks?: Rack[] };
type Rack = { id: string; rack_code: string; cells?: ShelfCell[] };
type ShelfCell = {
	row: number;
	column: number;
	cell_code: string;
	location_code: string;
	shelf_location_id: string;
	occupied?: boolean;
};
const newLine = (): Line => ({
	productId: "",
	quantity: "1",
	shelfLocationId: "",
});

function LocationCascade({
	warehouses,
	value,
	reservedLocationIds,
	onChange,
}: {
	warehouses: Warehouse[];
	value: string;
	reservedLocationIds: string[];
	onChange: (locationId: string) => void;
}) {
	const selectedCell = warehouses
		.flatMap((warehouse) =>
			(warehouse.racks || []).flatMap((rack) =>
				(rack.cells || []).map((cell) => ({ warehouse, rack, cell })),
			),
		)
		.find(({ cell }) => String(cell.shelf_location_id) === value);
	const [warehouseId, setWarehouseId] = useState(
		selectedCell?.warehouse.id || "",
	);
	const [rackId, setRackId] = useState(selectedCell?.rack.id || "");
	const racks =
		warehouses.find((warehouse) => String(warehouse.id) === warehouseId)
			?.racks || [];
	const cells = racks.find((rack) => String(rack.id) === rackId)?.cells || [];

	useEffect(() => {
		if (!selectedCell) return;
		setWarehouseId(selectedCell.warehouse.id);
		setRackId(selectedCell.rack.id);
	}, [selectedCell?.warehouse.id, selectedCell?.rack.id]);

	return (
		<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
			<select
				className="input min-w-0 border-slate-200 bg-white text-sm"
				aria-label="Warehouse"
				value={warehouseId}
				onChange={(event) => {
					setWarehouseId(event.target.value);
					setRackId("");
					onChange("");
				}}
			>
				<option value="">Warehouse</option>
				{warehouses.map((warehouse) => (
					<option key={warehouse.id} value={warehouse.id}>
						{warehouse.name}
					</option>
				))}
			</select>
			<select
				className="input min-w-0 border-slate-200 bg-white text-sm disabled:bg-slate-50 disabled:text-slate-400"
				aria-label="Rack"
				value={rackId}
				disabled={!warehouseId}
				onChange={(event) => {
					setRackId(event.target.value);
					onChange("");
				}}
			>
				<option value="">
					{warehouseId ? "Rack" : "Choose warehouse first"}
				</option>
				{racks.map((rack) => (
					<option key={rack.id} value={rack.id}>
						{rack.rack_code}
					</option>
				))}
			</select>
			<select
				className="input min-w-0 border-slate-200 bg-white text-sm disabled:bg-slate-50 disabled:text-slate-400"
				aria-label="Shelf position"
				value={value}
				disabled={!rackId}
				required
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="">
					{rackId ? "Shelf position" : "Choose rack first"}
				</option>
				{cells.map((cell) => (
					<option
						key={cell.shelf_location_id}
						value={cell.shelf_location_id}
						disabled={
							Boolean(cell.occupied) ||
							(reservedLocationIds.includes(
								String(cell.shelf_location_id),
							) &&
								String(cell.shelf_location_id) !== value)
						}
					>
						{cell.cell_code} ·{" "}
						{cell.occupied
							? "In use"
							: reservedLocationIds.includes(
										String(cell.shelf_location_id),
								  ) && String(cell.shelf_location_id) !== value
								? "Assigned to another product"
								: "Empty"}
					</option>
				))}
			</select>
		</div>
	);
}

export default function QCBatches() {
	const [products, setProducts] = useState<any[]>([]);
	const [uoms, setUoms] = useState<any[]>([]);
	const [bagQuantities, setBagQuantities] = useState<any[]>([]);
	const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
	const [batches, setBatches] = useState<any[]>([]);
	const [lines, setLines] = useState<Line[]>([newLine()]);
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 250);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [loaded, setLoaded] = useState(false);

	const reload = async () => {
		const [productRows, uomRows, bagRows, warehouseRows, batchRows] =
			await Promise.all([
				api.products.list(),
				api.masters.list("uoms"),
				api.masters.list("bag-quantities"),
				api.storage.list(),
				api.batches.list(),
			]);
		setProducts(productRows);
		setUoms(uomRows);
		setBagQuantities(bagRows);
		setWarehouses(
			(warehouseRows || []).filter(
				(row: any) =>
					row.is_active == null ||
					row.is_active === true ||
					Number(row.is_active) === 1,
			),
		);
		setBatches(batchRows);
		setLoaded(true);
	};
	useEffect(() => {
		void reload().catch((err) => {
			setError(err.message || "Could not load batches");
			setLoaded(true);
		});
	}, []);

	const getUom = (product: any) => {
		const id = product?.bag_quantity_id;
		const value = [...uoms, ...bagQuantities].find(
			(row) => String(row.id) === String(id),
		);
		return (
			value?.name ||
			(value?.quantity && value?.unit
				? `${value.quantity} ${value.unit}`
				: "UOM not set")
		);
	};
	const updateLine = (index: number, patch: Partial<Line>) =>
		setLines((current) =>
			current.map((line, i) =>
				i === index ? { ...line, ...patch } : line,
			),
		);
	const availableLocationCount = warehouses.reduce(
		(total, warehouse) =>
			total +
			(warehouse.racks || []).reduce(
				(rackTotal, rack) => rackTotal + (rack.cells || []).length,
				0,
			),
		0,
	);

	const canCreate = useMemo(
		() =>
			lines.length > 0 &&
			availableLocationCount > 0 &&
			new Set(lines.map((line) => line.productId).filter(Boolean))
				.size === lines.filter((line) => line.productId).length &&
			lines.every((line) => {
				const product = products.find(
					(row) => String(row.id) === line.productId,
				);
				return (
					line.productId &&
					getUom(product) !== "UOM not set" &&
					line.shelfLocationId &&
					!warehouses
						.flatMap((warehouse) => warehouse.racks || [])
						.flatMap((rack) => rack.cells || [])
						.find(
							(cell) =>
								String(cell.shelf_location_id) ===
								line.shelfLocationId,
						)?.occupied &&
					Number.isInteger(Number(line.quantity)) &&
					Number(line.quantity) > 0 &&
					Number(line.quantity) <= 1000
				);
			}) &&
			new Set(lines.map((line) => line.shelfLocationId).filter(Boolean))
				.size === lines.length,
		[
			lines,
			products,
			uoms,
			bagQuantities,
			availableLocationCount,
			warehouses,
		],
	);

	const create = async (event: React.FormEvent) => {
		event.preventDefault();
		if (busy || !canCreate) return;
		setError("");
		setMessage("");
		setBusy(true);
		let printerName: string;
		let labelSize = { widthMm: 60, heightMm: 64 };
		try {
			try {
				labelSize = await api.auth.printerLabelSize();
			} catch {
				// Use the application default label size when tenant dimensions are unavailable.
			}
			printerName = await prepareDirectQrPrinter();
		} catch (printerError: any) {
			setError(
				printerError.message ||
					"Direct printer unavailable. No batch was created.",
			);
			setBusy(false);
			return;
		}
		try {
			const result = await api.batches.createGroup({
				items: lines.map((line) => {
					const product = products.find(
						(row) => String(row.id) === line.productId,
					);
					return {
						product_id: line.productId,
						quantity: Number(line.quantity),
						uom: getUom(product),
						shelf_location_id: line.shelfLocationId,
						unit_price: Number(product?.price || 0),
					};
				}),
			});
			const allLabels = result.labels;
			try {
				await printQrLabelsDirect(
					allLabels,
					{
						id: result.id,
						job_code: result.batch_number,
						product_name: `Batch ${result.batch_number}`,
						product_sku: "MULTI",
						quantity: allLabels.length,
					},
					labelSize,
					printerName,
					(sent, total, status) =>
						setMessage(
							status ||
								`Sending QR labels to ${printerName}: ${sent} / ${total} queued…`,
						),
				);
				setMessage(
					`Created 1 batch with ${result.product_count} product${result.product_count === 1 ? "" : "s"}. Sent ${allLabels.length} fixed-size QR image labels to the ${printerName} print queue.`,
				);
			} catch (printError: any) {
				setMessage(
					`Created 1 batch with ${result.product_count} product${result.product_count === 1 ? "" : "s"}, but the direct print could not be sent. Request a reprint from an administrator. (${printError.message || "Printer unavailable"})`,
				);
			}
			setLines([newLine()]);
			setShowCreateForm(false);
			await reload();
		} catch (err: any) {
			setError(err.message || "Could not create batches");
		} finally {
			setBusy(false);
		}
	};

	const totalQuantity = lines.reduce(
		(total, line) => total + (Number(line.quantity) || 0),
		0,
	);
	const qrLabelCount = lines.reduce((total, line) => {
		const quantity = Number(line.quantity);
		return (
			total +
			(line.productId && Number.isInteger(quantity) && quantity > 0
				? quantity
				: 0)
		);
	}, 0);
	const groupedBatches = useMemo(() => {
		const groups = new Map<string, any>();
		for (const batch of batches) {
			const key = String(
				batch.parent_batch_number ? batch.batch_group_id : batch.id,
			);
			const group = groups.get(key) || {
				...batch,
				id: key,
				batch_number: batch.parent_batch_number || batch.batch_number,
				product_lines: [],
				quantity_total: 0,
				qr_count_total: 0,
			};
			group.product_lines.push({
				...batch,
				product_name: batch.product_name || "Product",
			});
			group.quantity_total += Number(batch.quantity || 0);
			group.qr_count_total += Number(batch.qr_count || 0);
			groups.set(key, group);
		}
		return [...groups.values()];
	}, [batches]);
	const filteredBatches = groupedBatches.filter((batch) => {
		const query = debouncedSearch.trim().toLowerCase();
		return (
			!query ||
			String(batch.batch_number || "")
				.toLowerCase()
				.includes(query) ||
			String(batch.product_name || "")
				.toLowerCase()
				.includes(query) ||
			batch.product_lines.some(
				(line: any) =>
					String(line.product_name || "")
						.toLowerCase()
						.includes(query) ||
					String(line.product_sku || "")
						.toLowerCase()
						.includes(query),
			)
		);
	});

	return (
		<div className="mx-auto max-w-7xl space-y-6">
			<header className="flex flex-col gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm sm:p-6 md:flex-row md:items-center md:justify-between">
				<div className="flex items-center gap-4">
					<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
						<Boxes size={25} />
					</div>
					<div>
						<h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
							Stock Batches
						</h1>
						<p className="mt-1 text-sm text-slate-500 sm:text-base">
							Create one stock batch with multiple products and
							print its QR labels.
						</p>
					</div>
				</div>
				<button
					type="button"
					onClick={() => {
						setError("");
						setMessage("");
						setShowCreateForm(true);
					}}
					className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
				>
					<Plus size={18} /> Create batch
				</button>
			</header>
			{error && (
				<div
					role="alert"
					className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
				>
					{error}
				</div>
			)}
			{message && (
				<div
					role="status"
					className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"
				>
					{message}
				</div>
			)}

			<section className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
				<div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
					<div>
						<h2 className="text-xl font-extrabold tracking-tight text-slate-900">
							All batches
						</h2>
						<p className="mt-1 text-sm font-medium text-slate-500">
							View stock batches created for your organization.
						</p>
					</div>
					<div className="flex items-center gap-3">
						<label className="relative block w-full sm:w-72">
							<Search
								size={16}
								className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
							/>
							<input
								className="input pl-9"
								value={search}
								onChange={(event) =>
									setSearch(event.target.value)
								}
								placeholder="Search batch or product"
								aria-label="Search batches"
							/>
						</label>
						<span className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-700">
							{filteredBatches.length}
						</span>
					</div>
				</div>
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Batch</th>
								<th>Products in batch</th>
								<th>Total units</th>
								<th>Status</th>
								<th>Created</th>
							</tr>
						</thead>
						<tbody>
							{filteredBatches.map((batch) => (
								<tr key={batch.id}>
									<td className="font-mono text-xs font-bold">
										{batch.batch_number}
									</td>
									<td className="font-semibold text-slate-800">
										<div className="space-y-1.5">
											{batch.product_lines.map(
												(line: any) => (
													<div
														key={line.id}
														className="flex flex-wrap items-center gap-x-2 text-sm"
													>
														<span>
															{line.product_name}
														</span>
														<span className="font-mono text-xs text-slate-400">
															{line.product_sku}
														</span>
														<span className="font-semibold text-slate-600">
															{line.uom} ×{" "}
															{line.quantity}
														</span>
														<span className="text-xs text-slate-400">
															{line.location_code ||
																line.storage_location ||
																"No location"}
														</span>
													</div>
												),
											)}
										</div>
									</td>
									<td className="font-semibold">
										{batch.quantity_total.toLocaleString()}{" "}
										units
									</td>
									<td>
										<span className="badge badge-success">
											{batch.status}
										</span>
									</td>
									<td className="text-xs font-medium text-slate-500">
										{batch.created_at
											? new Date(
													batch.created_at,
												).toLocaleString()
											: "-"}
									</td>
								</tr>
							))}
							{loaded && filteredBatches.length === 0 && (
								<tr>
									<td colSpan={5}>
										<div className="empty-state">
											<div className="empty-title">
												{search
													? "No matching batches"
													: "No batches yet"}
											</div>
											<div className="empty-desc">
												{search
													? "Try another batch number or product name."
													: "Create your first stock batch to see it here."}
											</div>
										</div>
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</section>

			{showCreateForm && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs sm:p-6"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget && !busy)
							setShowCreateForm(false);
					}}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="create-batch-title"
						className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-y-auto rounded-3xl bg-white shadow-2xl"
					>
						<form onSubmit={create}>
							<div className="relative flex flex-col gap-4 bg-white px-5 pb-4 pt-6 sm:px-8 sm:pb-5 sm:pt-7 lg:flex-row lg:items-center lg:justify-between lg:pr-16">
								<div className="flex items-start gap-3 pr-12">
									<div className="flex items-start gap-3">
										<div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
											<PackagePlus size={20} />
										</div>
										<div>
											<h2
												id="create-batch-title"
												className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl"
											>
												Create a batch
											</h2>
											<p className="mt-1.5 max-w-xl text-sm text-slate-500 sm:text-base">
												Build your batch by adding
												products, setting quantities,
												and choosing storage locations.
											</p>
											<p className="mt-1 text-xs font-semibold text-slate-500">
												Initial QR labels print once.
												For missing or damaged labels,
												request an admin-approved
												reprint.
											</p>
										</div>
									</div>
									<button
										type="button"
										className="absolute right-5 top-5 rounded-full p-2.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 sm:right-7 sm:top-7"
										aria-label="Close create batch dialog"
										onClick={() => setShowCreateForm(false)}
										disabled={busy}
									>
										<X size={20} />
									</button>
								</div>
							</div>

							<div className="space-y-1 px-5 py-4 sm:px-8 sm:py-5">
								<div className="mb-1 hidden grid-cols-[minmax(0,1fr)_150px_1fr_40px] gap-5 px-1 pb-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400 sm:grid">
									<span>Product</span>
									<span>UOM x Quantity</span>
									<span>Storage location</span>
									<span />
								</div>
								{lines.map((line, index) => {
									const product = products.find(
										(row) =>
											String(row.id) === line.productId,
									);
									return (
										<div
											key={index}
											className="grid gap-3 border-b border-slate-100 py-3.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_150px_1fr_40px] sm:items-end sm:gap-5"
										>
											<div>
												<label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600 sm:sr-only">
													Product
												</label>
												<select
													className="input border-slate-200 bg-slate-50/50 font-semibold text-slate-800 focus:bg-white"
													value={line.productId}
													required
													onChange={(event) =>
														updateLine(index, {
															productId:
																event.target
																	.value,
														})
													}
												>
													<option value="">
														Select product
													</option>
													{products.map((row) => (
														<option
															key={row.id}
															value={row.id}
														>
															{row.name} ·{" "}
															{row.sku}
														</option>
													))}
												</select>
												{product &&
													getUom(product) ===
														"UOM not set" && (
														<p className="mt-1 text-xs font-semibold text-rose-600">
															Set a UOM on the
															product first.
														</p>
													)}
											</div>
											<div>
												<label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600 sm:sr-only">
													Quantity
												</label>
												<div className="space-y-1.5">
													<div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
														Unit:{" "}
														<span className="normal-case tracking-normal text-slate-700">
															{product
																? getUom(
																		product,
																	)
																: "Select product"}
														</span>
													</div>
													<div className="flex items-center gap-1.5">
														<button
															type="button"
															className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
															aria-label={`Decrease quantity for product ${index + 1}`}
															disabled={
																Number(
																	line.quantity,
																) <= 1
															}
															onClick={() =>
																updateLine(
																	index,
																	{
																		quantity:
																			String(
																				Math.max(
																					1,
																					Number(
																						line.quantity ||
																							1,
																					) -
																						1,
																				),
																			),
																	},
																)
															}
														>
															<Minus size={14} />
														</button>
														<input
															className="input h-10 min-w-0 flex-1 border-slate-200 bg-white text-center font-bold text-slate-900"
															type="text"
															inputMode="numeric"
															pattern="[0-9]*"
															value={
																line.quantity
															}
															required
															onChange={(event) =>
																updateLine(
																	index,
																	{
																		quantity:
																			event.target.value
																				.replace(
																					/[^0-9]/g,
																					"",
																				)
																				.slice(
																					0,
																					4,
																				),
																	},
																)
															}
															onBlur={() =>
																updateLine(
																	index,
																	{
																		quantity:
																			String(
																				Math.min(
																					1000,
																					Math.max(
																						1,
																						Number(
																							line.quantity,
																						) ||
																							1,
																					),
																				),
																			),
																	},
																)
															}
														/>
														<button
															type="button"
															className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
															aria-label={`Increase quantity for product ${index + 1}`}
															disabled={
																Number(
																	line.quantity,
																) >= 1000
															}
															onClick={() =>
																updateLine(
																	index,
																	{
																		quantity:
																			String(
																				Math.min(
																					1000,
																					Number(
																						line.quantity ||
																							1,
																					) +
																						1,
																				),
																			),
																	},
																)
															}
														>
															<Plus size={14} />
														</button>
													</div>
												</div>
											</div>
											<div>
												<label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600 sm:sr-only">
													Storage location
												</label>
												<LocationCascade
													warehouses={warehouses}
													value={line.shelfLocationId}
													reservedLocationIds={lines
														.filter(
															(_, rowIndex) =>
																rowIndex !==
																index,
														)
														.map(
															(row) =>
																row.shelfLocationId,
														)}
													onChange={(value) =>
														updateLine(index, {
															shelfLocationId:
																value,
														})
													}
												/>
											</div>
											<button
												className="btn-ghost rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
												type="button"
												aria-label={`Remove product row ${index + 1}`}
												disabled={lines.length === 1}
												onClick={() =>
													setLines((current) =>
														current.filter(
															(_, i) =>
																i !== index,
														),
													)
												}
											>
												<Trash2 size={16} />
											</button>
										</div>
									);
								})}
								{availableLocationCount === 0 && loaded && (
									<p className="text-sm text-rose-600">
										Add a warehouse, rack, and shelf
										position under Warehouse Management
										before creating a batch.
									</p>
								)}
								<div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
									<button
										type="button"
										className="btn-secondary"
										onClick={() =>
											setLines((current) => [
												...current,
												newLine(),
											])
										}
									>
										<Plus size={16} /> Add product
									</button>
									<div className="flex flex-wrap items-center justify-end gap-4">
										<p className="rounded-xl bg-emerald-50 px-3 py-2 text-right text-sm font-bold text-emerald-800">
											<span className="text-slate-900">
												{qrLabelCount.toLocaleString()}
											</span>{" "}
											QR{" "}
											{qrLabelCount === 1
												? "label"
												: "labels"}{" "}
											will be printed
										</p>
										<button
											type="submit"
											className="btn-primary min-w-48 justify-center rounded-xl px-5 py-3 font-bold shadow-sm"
											disabled={
												!canCreate ||
												busy ||
												!loaded ||
												products.length === 0
											}
										>
											{busy ? (
												"Creating batches…"
											) : (
												<>
													<Printer size={16} /> Create
													&amp; print{" "}
													{qrLabelCount.toLocaleString()}{" "}
													labels
												</>
											)}
										</button>
									</div>
								</div>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
