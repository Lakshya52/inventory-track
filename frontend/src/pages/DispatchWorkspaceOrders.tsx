import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
	ArrowRight,
	Check,
	ClipboardList,
	Download,
	FileText,
	MapPin,
	Package,
	Plus,
	RefreshCw,
	ScanLine,
	Search,
	ShoppingCart,
	Truck,
	X,
} from "lucide-react";
import { api } from "../services/api";
import type { EntityId } from "../types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

function operationId(): string {
	return typeof crypto !== "undefined" && crypto.randomUUID
		? crypto.randomUUID()
		: `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function DispatchWorkspaceOrders() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const [batches, setBatches] = useState<any[]>([]);
	const [clients, setClients] = useState<any[]>([]);
	const [orders, setOrders] = useState<any[]>([]);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [clientId, setClientId] = useState("");
	const [quantities, setQuantities] = useState<Record<string, number>>({});
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [clientSearch, setClientSearch] = useState("");
	const [clientPickerOpen, setClientPickerOpen] = useState(false);
	const debouncedSearch = useDebouncedValue(search, 250);
	const debouncedClientSearch = useDebouncedValue(clientSearch, 250);

	const load = useCallback(async () => {
		setError("");
		try {
			const [allBatches, clientRows, orderRows] = await Promise.all([
				api.batches.list(),
				api.clients.list(),
				api.dispatchOrders.mine(),
			]);
			setBatches(
				allBatches.filter(
					(row: any) =>
						["QC_PASSED", "DISPATCH_APPROVED"].includes(
							row.status,
						) && Number(row.qr_count) === Number(row.quantity),
				),
			);
			setClients(
				clientRows.filter(
					(row: any) =>
						row.is_active == null ||
						row.is_active === true ||
						Number(row.is_active) === 1,
				),
			);
			setOrders(orderRows);
		} catch (err: any) {
			setError(err.message || "Could not load dispatch data");
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		const id = searchParams.get("batch");
		if (id && batches.some((row) => String(row.id) === id))
			setSelectedIds((current) =>
				current.includes(id) ? current : [...current, id],
			);
	}, [batches, searchParams]);

	const filteredBatches = useMemo(
		() =>
			batches.filter((row) =>
				`${row.batch_number} ${row.product_name} ${row.product_sku}`
					.toLowerCase()
					.includes(debouncedSearch.toLowerCase()),
			),
		[batches, debouncedSearch],
	);
	const filteredClients = useMemo(() => clients.filter(client => `${client.name} ${client.contact_person || ''} ${client.gst_number || ''}`.toLowerCase().includes(debouncedClientSearch.toLowerCase())), [clients, debouncedClientSearch]);
	const selectedClient = clients.find(client => String(client.id) === clientId);
	const setAllSelected = (checked: boolean) => {
		if (!checked) {
			setSelectedIds([]);
			setQuantities({});
			return;
		}
		const eligible = filteredBatches
			.filter((row) => availableFor(row) > 0)
			.map((row) => String(row.id));
		setSelectedIds((current) => [...new Set([...current, ...eligible])]);
		setQuantities((current) => ({
			...current,
			...Object.fromEntries(
				filteredBatches
					.filter((row) => availableFor(row) > 0)
					.map((row) => [String(row.id), availableFor(row)]),
			),
		}));
	};
	const batchById = useMemo(
		() => new Map(batches.map((batch) => [String(batch.id), batch])),
		[batches],
	);
	const selectedBatches = useMemo(
		() => selectedIds.map((id) => batchById.get(id)).filter(Boolean),
		[selectedIds, batchById],
	);
	const availableFor = (batch: any) =>
		Number(
			batch.available_quantity ??
				Math.max(
					0,
					Number(batch.quantity) -
						Number(batch.reserved_quantity || 0) -
						Number(batch.recalled_quantity || 0),
				),
		);
	const selectedUnits = selectedIds.reduce(
		(sum, id) => sum + Number(quantities[id] || 0),
		0,
	);
	const toggleBatch = (id: string) => {
		const batch = batchById.get(id);
		setSelectedIds((current) => {
			if (current.includes(id))
				return current.filter((value) => value !== id);
			if (batch && availableFor(batch) > 0)
				setQuantities((values) => ({
					...values,
					[id]: values[id] || availableFor(batch),
				}));
			return [...current, id];
		});
	};
	const setQuantity = (id: string, raw: string, max: number) => {
		const value =
			raw === ""
				? 0
				: Math.max(0, Math.min(max, Math.floor(Number(raw) || 0)));
		setQuantities((current) => ({ ...current, [id]: value }));
	};

	const downloadPdf = async (order: any) => {
		setError("");
		try {
			await api.dispatchOrders.downloadPackingListPdf(
				order.id,
				`packing-list-${order.batch_number}.pdf`,
			);
		} catch (err: any) {
			setError(err.message || "Could not download the packaging list");
		}
	};

	const createOrder = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		if (!selectedIds.length || !clientId) {
			setError("Select at least one batch and a client.");
			return;
		}
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const result = await api.dispatchOrders.raise({
				items: selectedIds.map((id) => ({ batch_id: id as EntityId, quantity: Number(quantities[id] || 0) })),
				client_id: clientId,
				client_operation_id: operationId(),
			});
			const orderId = result?.id ?? result?.entityId;
			if (!orderId) throw new Error("The order was not created. Refresh and try again.");
			setSelectedIds([]);
			setClientId("");
			setQuantities({});
			try {
				await api.dispatchOrders.downloadPackingListPdf(orderId, `packing-list-${result.batch_number || orderId}.pdf`);
				setMessage(`Created one dispatch order with ${selectedIds.length} product lines. Its packaging list was downloaded. Loading can begin.`);
			} catch (downloadError: any) {
				setMessage(`Order #${orderId} was created with ${selectedIds.length} product lines, but the packaging list could not download automatically. Download it from the order list.`);
				setError(downloadError.message || "Packaging list download failed.");
			}
		} catch (err: any) {
			setError(err.message || "Could not create the dispatch order. Refresh stock and try again.");
			return;
		}
		await load();
	};

	return (
		<div className="page-container space-y-6">
			<header className="page-header">
				<div>
					<p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-600">
						Dispatch workspace
					</p>
					<h1 className="page-title mt-1">Create a dispatch order</h1>
					<p className="page-subtitle">
						Pick stocked batches, set shipment quantities, and
						assign the customer. Loading can start as soon as the
						order is created.
					</p>
				</div>
				<button
					className="btn-secondary btn-sm"
					onClick={() => void load()}
					disabled={loading}
				>
					<RefreshCw
						size={14}
						className={loading ? "animate-spin" : ""}
					/>{" "}
					Refresh stock
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
			<form
				onSubmit={createOrder}
				className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"
			>
				<section className="card min-w-0 overflow-hidden">
					<div className="border-b border-surface-100 px-5 py-4 sm:px-6">
						<div className="flex items-start justify-between gap-4">
							<div>
								<h2 className="section-title flex items-center gap-2">
									<Package
										size={18}
										className="text-brand-600"
									/>{" "}
									Pick from available stock
								</h2>
								<p className="mt-1 text-sm text-surface-500">
										Add product lines from stock. All selected lines become one customer order.
								</p>
							</div>
							<span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
								{batches.length} batches
							</span>
						</div>
					</div>
					<div className="space-y-4 p-4 sm:p-5">
						<div className="flex flex-col gap-3 sm:flex-row">
							<label className="relative min-w-0 flex-1">
								<Search
									size={16}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
								/>
								<input
									autoFocus
									className="input h-11 pl-10"
									placeholder="Find product, SKU, or batch number"
									value={search}
									onChange={(event) =>
										setSearch(event.target.value)
									}
									aria-label="Search available batches"
								/>
							</label>
							<button
								type="button"
								className="btn-secondary btn-sm h-11 shrink-0"
								onClick={() => setAllSelected(true)}
								disabled={filteredBatches.length === 0}
							>
								Add visible
							</button>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-500">
							<span>
								Available units exclude orders already placed
								and recalled products.
							</span>
							{selectedIds.length > 0 && (
								<button
									type="button"
									className="font-semibold text-brand-700 hover:text-brand-800"
									onClick={() => {
										setSelectedIds([]);
										setQuantities({});
									}}
								>
									Clear selection
								</button>
							)}
						</div>
						<div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
							{filteredBatches.map((batch) => {
								const key = String(batch.id);
								const available = availableFor(batch);
								const selected = selectedIds.includes(key);
								const qty = Number(quantities[key] || 0);
								return (
									<article
										key={key}
										className={`rounded-xl border p-3 transition-colors sm:p-4 ${selected ? "border-brand-300 bg-brand-50/40 shadow-sm" : "border-surface-200 bg-white hover:border-surface-300"}`}
									>
										<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
											<button
												type="button"
												aria-pressed={selected}
												disabled={
													available < 1 && !selected
												}
												onClick={() => toggleBatch(key)}
												className={`flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg border transition-colors sm:self-center ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-surface-300 bg-white text-surface-400 hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"}`}
												aria-label={
													selected
														? `Remove ${batch.batch_number}`
														: `Add ${batch.batch_number}`
												}
											>
												{selected ? (
													<Check size={17} />
												) : (
													<Plus size={17} />
												)}
											</button>
											<button
												type="button"
												disabled={
													available < 1 && !selected
												}
												onClick={() => toggleBatch(key)}
												className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
											>
												<div className="truncate text-sm font-semibold text-surface-900">
													{batch.product_name}
												</div>
												<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-surface-500">
													<span className="font-mono text-surface-600">
													{batch.parent_batch_number || batch.batch_number}
													</span>
													{batch.parent_batch_number && <span className="text-surface-400">Stock lot {batch.batch_number}</span>}
													<span>·</span>
													<span>
														{batch.product_sku}
													</span>
													{batch.storage_location && (
														<>
															<span>·</span>
															<span className="inline-flex items-center gap-1">
																<MapPin
																	size={12}
																/>
																{
																	batch.storage_location
																}
															</span>
														</>
													)}
												</div>
											</button>
											<div className="flex items-center justify-between gap-3 border-t border-surface-100 pt-3 sm:w-[250px] sm:justify-end sm:border-0 sm:pt-0">
												<div className="sm:text-right">
													<div className="text-sm font-bold tabular-nums text-surface-900">
														{available.toLocaleString()}{" "}
														<span className="text-xs font-medium text-surface-500">
															x {batch.uom ||
																"units"}
														</span>
													</div>
													<div className="text-[11px] text-surface-500">
														available
													</div>
												</div>
												<div className="flex items-center gap-1.5">
													<input
														aria-label={`Quantity from ${batch.batch_number}`}
														className="input h-10 w-[92px] text-center font-semibold tabular-nums"
														type="number"
														inputMode="numeric"
														min="0"
														max={available}
														value={
															selected
																? (quantities[
																		key
																	] ?? "")
																: ""
														}
														onFocus={() => {
															if (!selected)
																toggleBatch(
																	key,
																);
														}}
														onChange={(event) =>
															setQuantity(
																key,
																event.target
																	.value,
																available,
															)
														}
														placeholder="Qty"
													/>
													<button
														type="button"
														className="rounded-lg border border-surface-200 px-2.5 py-2 text-xs font-semibold text-surface-600 hover:border-brand-300 hover:bg-white hover:text-brand-700 disabled:opacity-40"
														onClick={() => {
															if (!selected)
																toggleBatch(
																	key,
																);
															setQuantity(
																key,
																String(
																	available,
																),
																available,
															);
														}}
														disabled={available < 1}
													>
														All
													</button>
												</div>
											</div>
										</div>
										{selected && qty > 0 && (
											<div className="mt-3 flex items-center justify-between border-t border-brand-100 pt-2 text-xs">
												<span className="text-brand-800">
													Added to this dispatch
												</span>
												<span className="font-bold tabular-nums text-brand-800">
													{qty.toLocaleString()}{" "}
													x {batch.uom || "units"}
												</span>
											</div>
										)}
									</article>
								);
							})}
							{!loading && filteredBatches.length === 0 && (
								<div className="rounded-xl border border-dashed border-surface-300 px-4 py-12 text-center">
									<Package
										size={25}
										className="mx-auto text-surface-300"
									/>
									<p className="mt-3 text-sm font-semibold text-surface-700">
										{search
											? "No matching batches"
											: "No available stock"}
									</p>
									<p className="mt-1 text-xs text-surface-500">
										{search
											? "Try another product name, SKU, or batch number."
											: "QC batches appear here when their QR labels are ready."}
									</p>
								</div>
							)}
						</div>
					</div>
				</section>
				<aside className="xl:sticky xl:top-5">
					<div className="overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-sm">
						<div className="border-b border-surface-100 bg-surface-50/70 px-5 py-4">
							<div className="flex items-center gap-2">
								<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
									<ShoppingCart size={17} />
								</span>
								<div>
									<h2 className="font-bold text-surface-900">
										Dispatch summary
									</h2>
									<p className="text-xs text-surface-500">
										Review before creating
									</p>
								</div>
							</div>
						</div>
						<div className="space-y-4 p-5">
				<div className="relative">
					<label className="input-label" htmlFor="dispatch-client-search">Customer / party *</label>
					{selectedClient && !clientPickerOpen ? (
						<div className="flex h-11 items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3"><button type="button" className="min-w-0 truncate text-left text-sm font-semibold text-brand-800" onClick={() => { setClientSearch(selectedClient.name); setClientPickerOpen(true); }}>{selectedClient.name}{selectedClient.contact_person ? ` · ${selectedClient.contact_person}` : ''}</button><button type="button" className="ml-2 rounded p-1 text-brand-600 hover:bg-white" onClick={() => { setClientId(''); setClientSearch(''); setClientPickerOpen(true); }} aria-label="Change client"><X size={15} /></button></div>
					) : (
						<>
							<div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" /><input id="dispatch-client-search" className="input h-11 pl-9" value={clientSearch} onFocus={() => setClientPickerOpen(true)} onChange={event => { setClientSearch(event.target.value); setClientPickerOpen(true); }} placeholder="Search client name, contact, or GST" autoComplete="off" /></div>
							{clientPickerOpen && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-surface-200 bg-white p-1 shadow-lg">{filteredClients.map(client => <button key={client.id} type="button" className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-brand-50" onClick={() => { setClientId(String(client.id)); setClientSearch(''); setClientPickerOpen(false); }}><span><span className="block text-sm font-semibold text-surface-800">{client.name}</span><span className="block text-xs text-surface-500">{[client.contact_person, client.gst_number].filter(Boolean).join(' · ') || 'Client'}</span></span>{String(client.id) === clientId && <Check size={15} className="text-brand-600" />}</button>)}{filteredClients.length === 0 && <div className="px-3 py-4 text-center text-xs text-surface-500">No clients match that search.</div>}</div>}
						</>
					)}
					{clientPickerOpen && <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close client results" onClick={() => setClientPickerOpen(false)} />}
				</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="rounded-xl bg-surface-50 p-3">
									<div className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
										Batch lines
									</div>
									<div className="mt-1 text-2xl font-bold tabular-nums text-surface-900">
										{selectedIds.length}
									</div>
								</div>
								<div className="rounded-xl bg-brand-50 p-3">
									<div className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
										Total units
									</div>
									<div className="mt-1 text-2xl font-bold tabular-nums text-brand-800">
										{selectedUnits.toLocaleString()}
									</div>
								</div>
							</div>
							<div className="max-h-48 space-y-2 overflow-y-auto">
								{selectedBatches.map((batch: any) => {
									const key = String(batch.id);
									return (
										<div
											key={key}
											className="flex items-start justify-between gap-3 rounded-lg border border-surface-100 px-3 py-2.5"
										>
											<div className="min-w-0">
												<div className="truncate text-xs font-semibold text-surface-800">
													{batch.product_name}
												</div>
												<div className="mt-0.5 truncate font-mono text-[10px] text-surface-500">
													{batch.parent_batch_number || batch.batch_number}
												</div>
												{batch.parent_batch_number && <div className="truncate text-[10px] text-surface-400">Product lot {batch.batch_number}</div>}
											</div>
											<div className="flex shrink-0 items-center gap-2">
												<span className="text-xs font-bold tabular-nums text-surface-800">
													{Number(
														quantities[key] || 0,
													).toLocaleString()}{" "}
													x {batch.uom || ""}
												</span>
												<button
													type="button"
													className="rounded p-1 text-surface-400 hover:bg-rose-50 hover:text-rose-600"
													onClick={() =>
														toggleBatch(key)
													}
													aria-label={`Remove ${batch.batch_number}`}
												>
													<X size={14} />
												</button>
											</div>
										</div>
									);
								})}
								{selectedIds.length === 0 && (
									<div className="rounded-lg border border-dashed border-surface-200 px-3 py-5 text-center text-xs text-surface-400">
										Choose batches to build the order
									</div>
								)}
							</div>
							<div className="rounded-xl border border-surface-100 p-3">
								<div className="flex items-start gap-2">
									<Truck
										size={15}
										className="mt-0.5 text-surface-400"
									/>
									<p className="text-xs leading-5 text-surface-500">
										Driver and vehicle information is
										collected after scanning and loading.
									</p>
								</div>
							</div>
							<button
								className="btn-primary flex h-12 w-full justify-center"
								disabled={
									saving ||
									loading ||
									!clientId ||
									selectedIds.length === 0 ||
									selectedIds.some(
										(id) =>
											!Number.isInteger(
												Number(quantities[id]),
											) ||
											Number(quantities[id]) < 1 ||
											Number(quantities[id]) >
												availableFor(batchById.get(id)),
									)
								}
							>
								{saving ? (
									<>
										<RefreshCw
											size={16}
											className="animate-spin"
										/>{" "}
										Creating order…
									</>
								) : (
									<>
										Create one order{" "}
										<ArrowRight size={16} />
									</>
								)}
							</button>
							<p className="text-center text-[11px] leading-4 text-surface-400">
								Selected QR units are allocated when the order is created. Inventory is deducted after loading is finalized. One packing list covers every product line.
							</p>
						</div>
					</div>
				</aside>
			</form>
			<section className="card">
				<div className="card-header">
					<div>
						<h2 className="section-title">My dispatches</h2>
						<p className="mt-1 text-sm text-surface-500">
							Open packaging lists or continue scanning.
						</p>
					</div>
				</div>
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Batch / Product</th>
								<th>Client</th>
								<th>Quantity</th>
								<th>Status</th>
								<th className="text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{orders.map((order) => (
								<tr key={order.id}>
									<td>
										<span className="font-mono text-xs">
											{order.batch_number}
										</span>
										<div className="font-medium">
											{order.product_name}
										</div>
									</td>
									<td>{order.client_name || "-"}</td>
									<td>
										{order.quantity} {order.uom || ""}
									</td>
									<td>
										<span className="badge badge-info">
											{order.status === "APPROVED"
												? "Ready for loading"
												: order.status}
										</span>
									</td>
									<td>
										<div className="flex justify-end gap-2">
											{["APPROVED", "PENDING"].includes(
												order.status,
											) && (
												<button
													className="btn-primary btn-xs"
													onClick={() =>
														navigate(
															`/dispatch?order=${encodeURIComponent(order.id)}`,
														)
													}
												>
													<ScanLine size={13} /> Load
												</button>
											)}
											<button
												className="btn-secondary btn-xs"
												onClick={() =>
													navigate(
														`/packing-list?order=${encodeURIComponent(order.id)}`,
													)
												}
											>
												<FileText size={13} /> List
											</button>
											<button
												className="btn-ghost btn-xs"
												onClick={() =>
													void downloadPdf(order)
												}
											>
												<Download size={13} /> PDF
											</button>
										</div>
									</td>
								</tr>
							))}
							{!loading && orders.length === 0 && (
								<tr>
									<td colSpan={5}>
										<div className="empty-state">
											<div className="empty-icon">
												<Package size={20} />
											</div>
											<div className="empty-title">
												No dispatch orders yet
											</div>
										</div>
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
