import { useEffect, useMemo, useState } from "react";
import {
	Boxes,
	Check,
	MapPin,
	Plus,
	Printer,
	Trash2,
	PackagePlus,
	X,
	Search,
} from "lucide-react";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { printQrLabels } from "../utils/qrPdf";

type Line = { productId: string; quantity: string; shelfLocationId: string };
const newLine = (shared: boolean, locationId = ""): Line => ({
	productId: "",
	quantity: "1",
	shelfLocationId: shared ? locationId : "",
});

export default function QCBatches() {
	const [products, setProducts] = useState<any[]>([]);
	const [uoms, setUoms] = useState<any[]>([]);
	const [bagQuantities, setBagQuantities] = useState<any[]>([]);
	const [locations, setLocations] = useState<any[]>([]);
	const [batches, setBatches] = useState<any[]>([]);
	const [lines, setLines] = useState<Line[]>([newLine(false)]);
	const [useSharedLocation, setUseSharedLocation] = useState(false);
	const [sharedLocationId, setSharedLocationId] = useState("");
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 250);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [loaded, setLoaded] = useState(false);

	const reload = async () => {
		const [productRows, uomRows, bagRows, locationRows, batchRows] =
			await Promise.all([
				api.products.list(),
				api.masters.list("uoms"),
				api.masters.list("bag-quantities"),
				api.shelfLocations.list(),
				api.batches.list(),
			]);
		setProducts(productRows);
		setUoms(uomRows);
		setBagQuantities(bagRows);
		setLocations(
			locationRows.filter(
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
	const selectSharedLocation = (id: string) => {
		setSharedLocationId(id);
		setLines((current) =>
			current.map((line) => ({ ...line, shelfLocationId: id })),
		);
	};

	const canCreate = useMemo(
		() =>
			lines.length > 0 &&
			locations.length > 0 &&
			new Set(lines.map((line) => line.productId).filter(Boolean)).size === lines.filter((line) => line.productId).length &&
			lines.every((line) => {
				const product = products.find(
					(row) => String(row.id) === line.productId,
				);
				return (
					line.productId &&
					getUom(product) !== "UOM not set" &&
					line.shelfLocationId &&
					Number.isInteger(Number(line.quantity)) &&
					Number(line.quantity) > 0 &&
					Number(line.quantity) <= 1000
				);
			}),
		[lines, products, uoms, bagQuantities, locations],
	);

	const create = async (event: React.FormEvent) => {
		event.preventDefault();
		if (busy || !canCreate) return;
		setBusy(true);
		setError("");
		setMessage("");
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
				await printQrLabels(allLabels, {
					id: result.id,
					job_code: result.batch_number,
					product_name: `Batch ${result.batch_number}`,
					product_sku: "MULTI",
					quantity: allLabels.length,
				});
				setMessage(
					`Created 1 batch with ${result.product_count} product${result.product_count === 1 ? "" : "s"} and sent ${allLabels.length} QR labels to print.`,
				);
			} catch (printError: any) {
				setMessage(
					`Created 1 batch with ${result.product_count} product${result.product_count === 1 ? "" : "s"}. The print window could not open: ${printError.message || "allow pop-ups and request a reprint from an administrator if needed."}`,
				);
			}
			setLines([newLine(useSharedLocation, sharedLocationId)]);
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
			const key = String(batch.parent_batch_number ? batch.batch_group_id : batch.id);
			const group = groups.get(key) || {
				...batch,
				id: key,
				batch_number: batch.parent_batch_number || batch.batch_number,
				product_lines: [],
				quantity_total: 0,
				qr_count_total: 0,
			};
			group.product_lines.push({ ...batch, product_name: batch.product_name || "Product" });
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
			batch.product_lines.some((line: any) => String(line.product_name || "").toLowerCase().includes(query) || String(line.product_sku || "").toLowerCase().includes(query))
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
							Create one stock batch with multiple products and print its QR labels.
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
											{batch.product_lines.map((line: any) => <div key={line.id} className="flex flex-wrap items-center gap-x-2 text-sm"><span>{line.product_name}</span><span className="font-mono text-xs text-slate-400">{line.product_sku}</span><span className="font-semibold text-slate-600">{line.uom} × {line.quantity}</span><span className="text-xs text-slate-400">{line.location_code || line.storage_location || "No location"}</span></div>)}
										</div>
									</td>
									<td className="font-semibold">
										{batch.quantity_total.toLocaleString()} units
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
												Build your batch by adding products, setting quantities, and choosing storage locations.
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
								<div className="flex w-full items-center justify-between gap-5 self-end rounded-2xl bg-slate-50 px-4 py-3 sm:w-auto sm:min-w-80 lg:mr-8">
									<div>
										<p className="text-sm font-bold text-slate-800">
											Same location for all products
										</p>
										<p className="mt-0.5 text-xs font-medium text-slate-500">
											Use one shelf across this batch.
										</p>
									</div>
									<button
										type="button"
										role="switch"
										aria-checked={useSharedLocation}
										aria-label="Use one location for all products"
										onClick={() => {
											const next = !useSharedLocation;
											setUseSharedLocation(next);
											if (next && sharedLocationId)
												setLines((current) =>
													current.map((line) => ({
														...line,
														shelfLocationId:
															sharedLocationId,
													})),
												);
										}}
										className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${useSharedLocation ? "bg-primary-600" : "bg-surface-300"}`}
									>
										<span
											className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${useSharedLocation ? "translate-x-5" : "translate-x-0.5"}`}
										/>
									</button>
								</div>
							</div>

							{useSharedLocation && (
							<div className="bg-emerald-50/70 px-5 py-4 sm:px-8">
								<div className="grid gap-3 sm:grid-cols-[190px_1fr] sm:items-center">
										<div className="flex flex-wrap items-center gap-2 text-sm font-bold text-emerald-800">
											<MapPin size={17} /> Shared shelf
											<span className="basis-full pl-6 text-xs font-normal text-emerald-700">Applied to all products</span>
										</div>
										<div>
											<label
												className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600"
												htmlFor="shared-shelf"
											>
												Location applied to every
												product
											</label>
											<select
												id="shared-shelf"
												className="input border-transparent bg-white shadow-sm focus:border-emerald-300"
												value={sharedLocationId}
												required
												onChange={(event) =>
													selectSharedLocation(
														event.target.value,
													)
												}
											>
												<option value="">
													Choose a location
												</option>
												{locations.map((row) => (
													<option
														key={row.id}
														value={row.id}
													>
														{row.location_code}
														{row.description
															? ` · ${row.description}`
															: ""}
													</option>
												))}
											</select>
										</div>
									</div>
								</div>
							)}

							<div className="space-y-1 px-5 py-4 sm:px-8 sm:py-5">
								<div className="mb-1 hidden grid-cols-[minmax(0,1fr)_150px_1fr_40px] gap-5 px-1 pb-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400 sm:grid">
									<span>Product</span>
									<span>UOM x Quantity</span>
									<span>
										{useSharedLocation
											? "Shared location"
											: "Shelf location"}
									</span>
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
												<div className="flex">
                          <span className="inline-flex min-w-16 items-center justify-center rounded-l-xl bg-slate-100 px-2.5 text-xs font-bold text-slate-600">
                            {product
                              ? getUom(product)
                              : "UOM"}
                          </span>
													<input
														className="input rounded-l-none border-slate-200 bg-slate-50/50 font-bold text-slate-900 focus:bg-white"
														type="number"
														min="1"
														max="1000"
														step="1"
														value={line.quantity}
														required
														onChange={(event) =>
															updateLine(index, {
																quantity:
																	event.target
																		.value,
															})
														}
													/>
												</div>
											</div>
											<div>
												{useSharedLocation ? (
													<div>
														<label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600 sm:sr-only">
															Shelf location
														</label>
															<div className="flex h-10 items-center gap-2 rounded-xl bg-emerald-50 px-3 text-sm font-bold text-emerald-800">
															<MapPin size={15} />
															<span className="truncate">
																{locations.find(
																	(row) =>
																		String(
																			row.id,
																		) ===
																		line.shelfLocationId,
																)
																	?.location_code ||
																	"Choose shared shelf above"}
															</span>
															<Check
																size={15}
																className="ml-auto shrink-0"
															/>
														</div>
													</div>
												) : (
													<>
														<label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600 sm:sr-only">
															Shelf location
														</label>
														<select
															className="input border-slate-200 bg-slate-50/50 font-semibold text-slate-800 focus:bg-white"
															value={
																line.shelfLocationId
															}
															required
															onChange={(event) =>
																updateLine(
																	index,
																	{
																		shelfLocationId:
																			event
																				.target
																				.value,
																	},
																)
															}
														>
															<option value="">
																Select shelf
																location
															</option>
															{locations.map(
																(row) => (
																	<option
																		key={
																			row.id
																		}
																		value={
																			row.id
																		}
																	>
																		{
																			row.location_code
																		}
																		{row.description
																			? ` · ${row.description}`
																			: ""}
																	</option>
																),
															)}
														</select>
													</>
												)}
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
								{locations.length === 0 && loaded && (
									<p className="text-sm text-rose-600">
										Add an active shelf location in Masters
										before creating stock batches.
									</p>
								)}
								<div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
									<button
										type="button"
										className="btn-secondary"
										onClick={() =>
											setLines((current) => [
												...current,
												newLine(
													useSharedLocation,
													sharedLocationId,
												),
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
