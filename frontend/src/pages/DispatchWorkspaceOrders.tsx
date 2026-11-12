import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	CheckCircle2,
	ChevronDown,
	ClipboardList,
	Download,
	FileText,
	Loader2,
	MapPin,
	Minus,
	Package,
	Phone,
	Plus,
	RefreshCw,
	ScanLine,
	Search,
	ShoppingCart,
	Truck,
	Users,
	XCircle,
} from "lucide-react";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
	availableFor,
	buildBatchGroups,
	expandSelectedLines,
	type BatchGroup,
	type ProductLine,
} from "../utils/batchGroups";

function operationId(): string {
	return typeof crypto !== "undefined" && crypto.randomUUID
		? crypto.randomUUID()
		: `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const STEPS = [
	{ id: 1, title: "Select customer", icon: Users },
	{ id: 2, title: "Select printed batches", icon: Package },
	{ id: 3, title: "Review quantity", icon: ClipboardList },
	{ id: 4, title: "Transporter details", icon: Truck },
	{ id: 5, title: "Submit", icon: Check },
];

type OrderStatus = {
	ok: boolean;
	label: string;
	style: string;
};

function orderStatus(order: any): OrderStatus {
	switch (String(order?.status || "").toUpperCase()) {
		case "PENDING":
			return { ok: false, label: "Waiting for approval", style: "bg-amber-50 text-amber-700" };
		case "APPROVED":
			return { ok: true, label: "Ready to load", style: "bg-emerald-50 text-emerald-700" };
		case "REJECTED":
			return { ok: false, label: "Rejected", style: "bg-rose-50 text-rose-700" };
		case "CANCELLED":
			return { ok: false, label: "Cancelled", style: "bg-rose-50 text-rose-700" };
		case "CLOSED_DISPATCHED":
			return { ok: true, label: "Dispatched", style: "bg-emerald-50 text-emerald-700" };
		case "CLOSED_NOT_DISPATCHED":
			return { ok: false, label: "Not dispatched", style: "bg-surface-100 text-surface-600" };
		default:
			return { ok: false, label: String(order?.status || "Unknown"), style: "bg-surface-100 text-surface-600" };
	}
}

export default function DispatchWorkspaceOrders() {
	const navigate = useNavigate();
	const [step, setStep] = useState(1);
	const [batches, setBatches] = useState<any[]>([]);
	const [clients, setClients] = useState<any[]>([]);
	const [orders, setOrders] = useState<any[]>([]);
	const [selectedLineKeys, setSelectedLineKeys] = useState<string[]>([]);
	const [clientId, setClientId] = useState("");
	const [quantities, setQuantities] = useState<Record<string, number>>({});
	const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
	const [expandedLocations, setExpandedLocations] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [clientSearch, setClientSearch] = useState("");
	const [clientPickerOpen, setClientPickerOpen] = useState(false);
	const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
	const [cancellingId, setCancellingId] = useState<string | null>(null);
	const [cancelReason, setCancelReason] = useState("");
	// Transporter details travel with the order and end up on the packing list.
	const [transporterName, setTransporterName] = useState("");
	const [transporterMobile, setTransporterMobile] = useState("");
	const [vehicleNumber, setVehicleNumber] = useState("");
	const [containerNumber, setContainerNumber] = useState("");
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
			// Only QC-passed batches whose QR labels have been printed can be
			// put on a truck.
			setBatches(
				allBatches.filter(
					(row: any) =>
						String(row.status || "").toUpperCase() === "QC_PASSED" &&
						row.qr_printed === true &&
						Number(row.available_quantity ?? row.quantity ?? 0) > 0,
				),
			);
			setClients(
				clientRows.filter(
					(client: any) =>
						client.is_active == null ||
						client.is_active === true ||
						Number(client.is_active) === 1,
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

	const batchGroups = useMemo(() => buildBatchGroups(batches), [batches]);
	const lineByKey = useMemo(() => {
		const map = new Map<string, ProductLine>();
		for (const group of batchGroups) {
			for (const line of group.lines) map.set(line.key, line);
		}
		return map;
	}, [batchGroups]);
	const filteredGroups = useMemo(() => {
		const query = debouncedSearch.trim().toLowerCase();
		if (!query) return batchGroups;
		return batchGroups
			.map((group) => ({
				...group,
				lines: group.lines.filter((line) =>
					`${line.name} ${line.grade} ${line.sku} ${group.batchNumber} ${line.locations.join(" ")}`
						.toLowerCase()
						.includes(query),
				),
			}))
			.filter((group) => group.lines.length > 0);
	}, [batchGroups, debouncedSearch]);
	const filteredClients = useMemo(
		() =>
			clients.filter((client) =>
				`${client.name} ${client.contact_person || ""} ${client.gst_number || ""}`
					.toLowerCase()
					.includes(debouncedClientSearch.toLowerCase()),
			),
		[clients, debouncedClientSearch],
	);
	const selectedClient = clients.find((client) => String(client.id) === clientId);
	const selectedLines = useMemo(
		() =>
			selectedLineKeys
				.map((key) => lineByKey.get(key))
				.filter((line): line is ProductLine => Boolean(line)),
		[selectedLineKeys, lineByKey],
	);
	const selectedGroups = useMemo(
		() =>
			batchGroups
				.map((group) => ({
					...group,
					lines: group.lines.filter((line) =>
						selectedLineKeys.includes(line.key),
					),
				}))
				.filter((group) => group.lines.length > 0),
		[batchGroups, selectedLineKeys],
	);
	const selectedUnits = selectedLines.reduce(
		(sum, line) => sum + Number(quantities[line.key] || 0),
		0,
	);

	const toggleGroup = (key: string) => {
		setCollapsedGroups((current) =>
			current.includes(key)
				? current.filter((value) => value !== key)
				: [...current, key],
		);
	};
	const toggleLocations = (key: string) => {
		setExpandedLocations((current) =>
			current.includes(key)
				? current.filter((value) => value !== key)
				: [...current, key],
		);
	};

	const toggleLine = (line: ProductLine) => {
		setSelectedLineKeys((current) => {
			if (current.includes(line.key)) {
				setQuantities((values) => {
					const next = { ...values };
					delete next[line.key];
					return next;
				});
				return current.filter((value) => value !== line.key);
			}
			setQuantities((values) => ({
				...values,
				[line.key]: values[line.key] || line.available,
			}));
			return [...current, line.key];
		});
	};

	const setQuantity = (key: string, raw: string, max: number) => {
		const value = raw === "" ? 0 : Math.max(1, Math.min(max, Math.floor(Number(raw) || 1)));
		setQuantities((current) => ({ ...current, [key]: value }));
	};
	const adjustQuantity = (key: string, delta: number, max: number) => {
		const current = Number(quantities[key] || 1);
		setQuantity(key, String(current + delta), max);
	};

	/**
	 * The order is still raised per unit batch, because each unit carries its
	 * own QR label. A selected product line fans out to the unit batches that
	 * make it up.
	 */
	const buildOrderItems = () => expandSelectedLines(selectedLines, quantities);

	const downloadPdf = async (order: any) => {
		setError("");
		try {
			await api.dispatchOrders.downloadPackingListPdf(
				order.id,
				`packing-list-${order.batch_number || order.id}.pdf`,
			);
		} catch (err: any) {
			setError(err.message || "Could not download the packaging list");
		}
	};

	/**
	 * Cancelling frees the reserved QR labels and puts the stock back on the
	 * shelf. It only works while loading has not started.
	 */
	const cancelOrder = async (order: any) => {
		if (!cancelReason.trim()) {
			setError("Add a reason before cancelling the order.");
			return;
		}
		setSaving(true);
		setError("");
		try {
			await api.dispatchOrders.cancel(order.id, cancelReason.trim());
			setMessage(`Order #${order.id} was cancelled and the stock is free again.`);
			setCancellingId(null);
			setCancelReason("");
			await load();
		} catch (err: any) {
			setError(err.message || "Could not cancel the dispatch order");
		} finally {
			setSaving(false);
		}
	};

	const transporterComplete =
		transporterName.trim() &&
		transporterMobile.trim() &&
		vehicleNumber.trim() &&
		containerNumber.trim();

	const createOrder = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		const items = buildOrderItems();
		if (!items.length || !clientId) {
			setError("Select at least one batch and a customer.");
			return;
		}
		if (!transporterComplete) {
			setError("Add the transporter name, mobile number, vehicle number and container number.");
			return;
		}
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const result = await api.dispatchOrders.raise({
				items,
				client_id: clientId,
				driver_name: transporterName.trim(),
				driver_phone: transporterMobile.trim(),
				vehicle_number: vehicleNumber.trim(),
				container_number: containerNumber.trim(),
				client_operation_id: operationId(),
			});
			const orderId = result?.id ?? result?.entityId;
			if (!orderId) throw new Error("The order was not created. Refresh and try again.");
			setCreatedOrderId(String(orderId));
			setSelectedLineKeys([]);
			setClientId("");
			setQuantities({});
			setTransporterName("");
			setTransporterMobile("");
			setVehicleNumber("");
			setContainerNumber("");
			setMessage(
				`Order #${orderId} was created. Scan the QR codes on the mobile app to load it.`,
			);
			setStep(5);
			await load();
		} catch (err: any) {
			setError(err.message || "Could not create the dispatch order. Refresh stock and try again.");
			return;
		} finally {
			setSaving(false);
		}
	};

	const canContinue =
		step === 1
			? Boolean(clientId)
			: step === 2
				? selectedLineKeys.length > 0
				: step === 4
					? Boolean(transporterComplete)
					: true;

	const quantityStepper = (line: ProductLine) => {
		const qty = Number(quantities[line.key] || 0);
		const label = line.name || line.sku || "product";
		return (
			<div className="flex items-center gap-2">
				<button
					type="button"
					className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-200 text-surface-600 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label={`Decrease quantity for ${label}`}
					disabled={qty <= 1}
					onClick={() => adjustQuantity(line.key, -1, line.available)}
				>
					<Minus size={16} />
				</button>
				<input
					aria-label={`Quantity for ${label}`}
					className="input h-10 w-20 text-center font-semibold tabular-nums"
					type="text"
					inputMode="numeric"
					pattern="[0-9]*"
					value={qty}
					onChange={(event) =>
						setQuantity(line.key, event.target.value, line.available)
					}
				/>
				<button
					type="button"
					className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-200 text-surface-600 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label={`Increase quantity for ${label}`}
					disabled={qty >= line.available}
					onClick={() => adjustQuantity(line.key, 1, line.available)}
				>
					<Plus size={16} />
				</button>
				<span className="w-20 text-right text-xs text-surface-500">
					max {line.available}
				</span>
			</div>
		);
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
						Pick the customer, choose the printed batches, confirm the
						quantity, and send it for approval.
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
					Refresh
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

			{/* Step indicator */}
			<ol className="grid gap-2 sm:grid-cols-5">
				{STEPS.map((item) => {
					const active = step === item.id;
					const done = step > item.id;
					return (
						<li key={item.id}>
							<button
								type="button"
								onClick={() => {
									if (item.id < step) setStep(item.id);
								}}
								disabled={item.id > step}
								className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
									active
										? "border-brand-300 bg-brand-50/60"
										: done
											? "border-emerald-200 bg-emerald-50/50"
											: "border-surface-200 bg-white"
								} ${item.id > step ? "cursor-not-allowed opacity-60" : ""}`}
							>
								<span
									className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
										active
											? "bg-brand-600 text-white"
											: done
												? "bg-emerald-500 text-white"
												: "bg-surface-100 text-surface-500"
									}`}
								>
									{done ? <Check size={16} /> : <item.icon size={16} />}
								</span>
								<span className="min-w-0">
									<span className="block text-[11px] font-bold uppercase tracking-wide text-surface-400">
										Step {item.id}
									</span>
									<span className="block truncate text-sm font-semibold text-surface-800">
										{item.title}
									</span>
								</span>
							</button>
						</li>
					);
				})}
			</ol>

			<form onSubmit={createOrder} className="space-y-6">
				{/* STEP 1 - CUSTOMER */}
				{step === 1 && (
					<section className="card overflow-hidden">
						<div className="border-b border-surface-100 px-5 py-4 sm:px-6">
							<h2 className="section-title flex items-center gap-2">
								<Users size={18} className="text-brand-600" /> Select the
								customer
							</h2>
							<p className="mt-1 text-sm text-surface-500">
								Search by name, contact person, or GST number.
							</p>
						</div>
						<div className="space-y-4 p-5 sm:p-6">
							<div className="relative">
								<label className="input-label">Customer</label>
								<button
									type="button"
									onClick={() => setClientPickerOpen((open) => !open)}
									className="input flex h-12 w-full items-center justify-between gap-3 text-left"
									aria-expanded={clientPickerOpen}
								>
									<span className={selectedClient ? "truncate font-semibold text-surface-900" : "truncate text-surface-500"}>
										{selectedClient
											? `${selectedClient.name}${selectedClient.gst_number ? ` - GST ${selectedClient.gst_number}` : ""}`
											: "Choose a customer"}
									</span>
									<Search size={16} className="shrink-0 text-surface-400" />
								</button>
								{clientPickerOpen && (
									<div className="mt-2 overflow-hidden rounded-xl border border-surface-200 bg-white shadow-lg">
										<div className="border-b border-surface-100 p-2">
											<input
												autoFocus
												className="input h-10 w-full"
												placeholder="Search customer name or GST number"
												value={clientSearch}
												onChange={(event) => setClientSearch(event.target.value)}
												aria-label="Search customers"
											/>
										</div>
										<ul className="max-h-64 overflow-y-auto py-1">
											{filteredClients.map((client) => (
												<li key={client.id}>
													<button
														type="button"
														onClick={() => {
															setClientId(String(client.id));
															setClientPickerOpen(false);
															setClientSearch("");
														}}
														className={`flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-50 ${
															String(client.id) === clientId ? "bg-brand-50/60" : ""
														}`}
													>
														<span className="text-sm font-semibold text-surface-900">
															{client.name}
														</span>
														<span className="text-xs text-surface-500">
															{client.contact_person || "No contact"}
															{client.gst_number ? ` - GST ${client.gst_number}` : ""}
														</span>
													</button>
												</li>
											))}
											{filteredClients.length === 0 && (
												<li className="px-4 py-6 text-center text-sm text-surface-400">
													No customers match your search.
												</li>
											)}
										</ul>
									</div>
								)}
							</div>
							{selectedClient && (
								<div className="rounded-xl border border-surface-200 bg-surface-50 p-4 text-sm">
									<p className="font-semibold text-surface-900">{selectedClient.name}</p>
									<p className="mt-1 text-surface-500">
										{selectedClient.address || "No address on file"}
									</p>
									{selectedClient.phone && (
										<p className="mt-1 text-surface-500">{selectedClient.phone}</p>
									)}
								</div>
							)}
						</div>
					</section>
				}

                                <div className="mt-4 row-gap-2 row-cols-1 row-cols-sm-2 row-cols-lg-4">
                                    <label className="input-label col-span-12 sm:col-span-6">
                                        Scheduled Dispatch *
                                    </label>
                                    <div className="col-span-12 sm:col-span-6">
                                        <input
                                            id="scheduled-dispatch-at"
                                            type="datetime-local"
                                            className="input w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                                            value={scheduledDispatchAtString || ''}
                                            onChange={(e) => setScheduledDispatchAtString(e.target.value)}
                                            placeholder="e.g. 2025-01-15T14:30"
                                        />
                                        <AppText variant="caption" className="mt-1 text-[10px] text-surface-500">
                                            Planned date & time the load leaves the plant.
                                        </AppText>
                                    </div>
                                </div>
				)}

				{/* STEP 2 - BATCHES */}
				{step === 2 && (
					<section className="card overflow-hidden">
						<div className="border-b border-surface-100 px-5 py-4 sm:px-6">
							<h2 className="section-title flex items-center gap-2">
								<Package size={18} className="text-brand-600" /> Select the
								printed batches
							</h2>
							<p className="mt-1 text-sm text-surface-500">
								Only QC-passed batches with printed QR labels are listed.
								Open a batch to see the products and grades it holds, then
								choose what goes on the order.
							</p>
						</div>
						<div className="space-y-4 p-5 sm:p-6">
							<label className="relative block">
								<Search
									size={16}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
								/>
								<input
									className="input h-12 w-full pl-10"
									placeholder="Find product, grade, SKU, location, or batch number"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									aria-label="Search printed batches"
								/>
							</label>
							{loading ? (
								<div className="py-10 text-center text-sm text-surface-400">
									<Loader2 size={16} className="mr-2 inline animate-spin" />
									Loading printed batches…
								</div>
							) : filteredGroups.length === 0 ? (
								<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
									No printed batches are ready. Create a batch, wait for QC,
									and print the QR labels first.
								</div>
							) : (
								<ul className="space-y-3">
									{filteredGroups.map((group) => {
										const collapsed = collapsedGroups.includes(group.key);
										const picked = group.lines.filter((line) =>
											selectedLineKeys.includes(line.key),
										);
										const pickedUnits = picked.reduce(
											(sum, line) => sum + Number(quantities[line.key] || 0),
											0,
										);
										return (
											<li
												key={group.key}
												className="overflow-hidden rounded-xl border border-surface-200 bg-white"
											>
												<button
													type="button"
													onClick={() => toggleGroup(group.key)}
													aria-expanded={!collapsed}
													className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-50"
												>
													<ChevronDown
														size={16}
														className={`shrink-0 text-surface-400 transition-transform ${
															collapsed ? "-rotate-90" : ""
														}`}
													/>
													<span className="min-w-0 flex-1">
														<span className="block truncate font-mono text-sm font-bold text-surface-900">
															{group.batchNumber}
														</span>
														<span className="mt-0.5 block text-xs text-surface-500">
															{group.lines.length} product
															{group.lines.length === 1 ? "" : "s"} ·{" "}
															{group.unitCount} unit
															{group.unitCount === 1 ? "" : "s"} ·{" "}
															{group.available.toLocaleString()} available
														</span>
													</span>
													{picked.length > 0 && (
														<span className="badge badge-success shrink-0">
															{pickedUnits.toLocaleString()} selected
														</span>
													)}
												</button>
												{!collapsed && (
													<ul className="divide-y divide-surface-100 border-t border-surface-100">
														{group.lines.map((line) => {
															const selected = selectedLineKeys.includes(line.key);
															const showAll = expandedLocations.includes(line.key);
															const visible = showAll
																? line.locations
																: line.locations.slice(0, 2);
															const label = line.name || line.sku || "product";
															return (
																<li
																	key={line.key}
																	className={selected ? "bg-brand-50/40" : ""}
																>
																	<div className="flex items-start gap-3 px-4 py-3">
																		<button
																			type="button"
																			aria-pressed={selected}
																			aria-label={`${selected ? "Remove" : "Select"} ${label}`}
																			onClick={() => toggleLine(line)}
																			className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
																				selected
																					? "border-brand-600 bg-brand-600 text-white"
																					: "border-surface-300 bg-white text-surface-400 hover:border-brand-300"
																			}`}
																		>
																			{selected ? <Check size={17} /> : <Plus size={17} />}
																		</button>
																		<div className="min-w-0 flex-1">
																			<p className="truncate text-sm font-semibold text-surface-900">
																				{label}
																			</p>
																			<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-surface-500">
																				{line.grade && (
																					<span className="font-medium text-surface-600">
																						{line.grade}
																					</span>
																				)}
																				{line.sku && (
																					<span className="font-mono text-surface-500">
																						{line.sku}
																					</span>
																				)}
																				<span className="font-mono text-surface-400">
																					{group.batchNumber}
																				</span>
																			</p>
																			{line.locations.length > 0 && (
																				<p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-surface-500">
																					<MapPin size={12} className="shrink-0" />
																					{visible.map((location) => (
																						<span
																							key={location}
																							className="rounded-md bg-surface-100 px-1.5 py-0.5 font-mono text-[11px] text-surface-600"
																						>
																							{location}
																						</span>
																					))}
																					{line.locations.length > 2 && (
																						<button
																							type="button"
																							onClick={() => toggleLocations(line.key)}
																							className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand-600 hover:bg-brand-50"
																						>
																							{showAll
																								? "Show less"
																								: `+${line.locations.length - 2} more`}
																						</button>
																					)}
																				</p>
																			)}
																		</div>
																		<div className="shrink-0 text-right">
																			<span className="block text-sm font-bold tabular-nums text-surface-900">
																				{line.available.toLocaleString()}
																			</span>
																			<span className="block text-[11px] text-surface-500">
																				available
																			</span>
																		</div>
																	</div>
																	{selected && (
																		<div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-100 bg-white px-4 py-3">
																			<span className="text-xs font-bold uppercase tracking-wide text-surface-500">
																				Quantity to dispatch
																			</span>
																			{quantityStepper(line)}
																		</div>
																	)}
																</li>
															);
														})}
													</ul>
												)}
											</li>
										);
									})}
								</ul>
							)}
							{selectedLines.length > 0 && (
								<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200 bg-surface-50/70 px-5 py-3">
									<span className="text-sm text-surface-600">
										Customer:{" "}
										<strong className="text-surface-900">
											{selectedClient?.name || "—"}
										</strong>
									</span>
									<span className="text-sm text-surface-600">
										Selected:{" "}
										<strong className="tabular-nums text-surface-900">
											{selectedLines.length} line
											{selectedLines.length === 1 ? "" : "s"} ·{" "}
											{selectedUnits.toLocaleString()} units
										</strong>
									</span>
								</div>
							)}
						</div>
					</section>
				}

                                <div className="mt-4 row-gap-2 row-cols-1 row-cols-sm-2 row-cols-lg-4">
                                    <label className="input-label col-span-12 sm:col-span-6">
                                        Scheduled Dispatch *
                                    </label>
                                    <div className="col-span-12 sm:col-span-6">
                                        <input
                                            id="scheduled-dispatch-at"
                                            type="datetime-local"
                                            className="input w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                                            value={scheduledDispatchAtString || ''}
                                            onChange={(e) => setScheduledDispatchAtString(e.target.value)}
                                            placeholder="e.g. 2025-01-15T14:30"
                                        />
                                        <AppText variant="caption" className="mt-1 text-[10px] text-surface-500">
                                            Planned date & time the load leaves the plant.
                                        </AppText>
                                    </div>
                                </div>
				)}

				{/* STEP 3 - QUANTITY */}
				{step === 3 && (
					<section className="card overflow-hidden">
						<div className="border-b border-surface-100 px-5 py-4 sm:px-6">
							<h2 className="section-title flex items-center gap-2">
								<ClipboardList size={18} className="text-brand-600" /> Review
								the quantity
							</h2>
							<p className="mt-1 text-sm text-surface-500">
								Adjust how many units of each product go on this order.
							</p>
						</div>
						<ul className="divide-y divide-surface-100">
							{selectedGroups.map((group) => (
								<li key={group.key}>
									<div className="flex flex-wrap items-center justify-between gap-2 bg-surface-50 px-5 py-2.5 sm:px-6">
										<span className="font-mono text-xs font-bold text-surface-700">
											{group.batchNumber}
										</span>
										<span className="text-xs text-surface-500">
											{group.lines.reduce(
												(sum, line) => sum + Number(quantities[line.key] || 0),
												0,
											).toLocaleString()}{" "}
											units
										</span>
									</div>
									<ul className="divide-y divide-surface-100">
										{group.lines.map((line) => (
											<li
												key={line.key}
												className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
											>
												<div className="min-w-0">
													<p className="truncate text-sm font-semibold text-surface-900">
														{line.name || line.sku || "Unnamed product"}
													</p>
													<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-surface-500">
														{line.grade && (
															<span className="font-medium text-surface-600">
																{line.grade}
															</span>
														)}
														{line.sku && (
															<span className="font-mono">{line.sku}</span>
														)}
														{line.locations[0] && (
															<span className="inline-flex items-center gap-1">
																<MapPin size={12} />
																{line.locations[0]}
																{line.locations.length > 1
																	? ` +${line.locations.length - 1}`
																	: ""}
															</span>
														)}
													</p>
												</div>
												{quantityStepper(line)}
											</li>
										))}
									</ul>
								</li>
							))}
						</ul>
						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-100 bg-surface-50/70 px-5 py-4 sm:px-6">
							<span className="text-sm text-surface-600">
								Customer:{" "}
								<strong className="text-surface-900">
									{selectedClient?.name || "—"}
								</strong>
							</span>
							<span className="text-sm text-surface-600">
								Total units:{" "}
								<strong className="tabular-nums text-surface-900">
									{selectedUnits.toLocaleString()}
								</strong>
							</span>
						</div>
					</section>
				}

                                <div className="mt-4 row-gap-2 row-cols-1 row-cols-sm-2 row-cols-lg-4">
                                    <label className="input-label col-span-12 sm:col-span-6">
                                        Scheduled Dispatch *
                                    </label>
                                    <div className="col-span-12 sm:col-span-6">
                                        <input
                                            id="scheduled-dispatch-at"
                                            type="datetime-local"
                                            className="input w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                                            value={scheduledDispatchAtString || ''}
                                            onChange={(e) => setScheduledDispatchAtString(e.target.value)}
                                            placeholder="e.g. 2025-01-15T14:30"
                                        />
                                        <AppText variant="caption" className="mt-1 text-[10px] text-surface-500">
                                            Planned date & time the load leaves the plant.
                                        </AppText>
                                    </div>
                                </div>
				)}

				{/* STEP 4 - TRANSPORTER DETAILS */}
				{step === 4 && (
					<section className="card overflow-hidden">
						<div className="border-b border-surface-100 px-5 py-4 sm:px-6">
							<h2 className="section-title flex items-center gap-2">
								<Truck size={18} className="text-brand-600" /> Transporter
								details
							</h2>
							<p className="mt-1 text-sm text-surface-500">
								Who is moving the goods? These details are saved on the order
								and printed on the packing list.
							</p>
						</div>
						<div className="space-y-4 p-5 sm:px-6">
							<div className="grid gap-4 sm:grid-cols-2">
								<div>
									<label className="input-label" htmlFor="transporter-name">
										Transporter name *
									</label>
									<input
										id="transporter-name"
										className="input"
										value={transporterName}
										onChange={(event) => setTransporterName(event.target.value)}
										placeholder="e.g. Ramesh Transport Co."
										maxLength={150}
									/>
								</div>
								<div>
									<label className="input-label" htmlFor="transporter-mobile">
										Transporter mobile number *
									</label>
									<div className="relative">
										<Phone
											size={15}
											className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
										/>
										<input
											id="transporter-mobile"
											className="input pl-9"
											value={transporterMobile}
											onChange={(event) => setTransporterMobile(event.target.value)}
											placeholder="e.g. 98765 43210"
											inputMode="tel"
											maxLength={32}
										/>
									</div>
								</div>
								<div>
									<label className="input-label" htmlFor="vehicle-number">
										Vehicle number *
									</label>
									<input
										id="vehicle-number"
										className="input"
										value={vehicleNumber}
										onChange={(event) => setVehicleNumber(event.target.value)}
										placeholder="e.g. MH-12-AB-1234"
										maxLength={50}
									/>
								</div>
								<div>
									<label className="input-label" htmlFor="container-number">
										Container number *
									</label>
									<input
										id="container-number"
										className="input"
										value={containerNumber}
										onChange={(event) => setContainerNumber(event.target.value)}
										placeholder="e.g. CONT-9021"
										maxLength={100}
									/>
								</div>
							</div>
							<p className="text-xs text-surface-500">
								The ordered units leave the stock as soon as the order is
								created, and these details travel with the order to the
								packing list.
							</p>
						</div>
					</section>
				}

                                <div className="mt-4 row-gap-2 row-cols-1 row-cols-sm-2 row-cols-lg-4">
                                    <label className="input-label col-span-12 sm:col-span-6">
                                        Scheduled Dispatch *
                                    </label>
                                    <div className="col-span-12 sm:col-span-6">
                                        <input
                                            id="scheduled-dispatch-at"
                                            type="datetime-local"
                                            className="input w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                                            value={scheduledDispatchAtString || ''}
                                            onChange={(e) => setScheduledDispatchAtString(e.target.value)}
                                            placeholder="e.g. 2025-01-15T14:30"
                                        />
                                        <AppText variant="caption" className="mt-1 text-[10px] text-surface-500">
                                            Planned date & time the load leaves the plant.
                                        </AppText>
                                    </div>
                                </div>
				)}

				{/* STEP 5 - SUBMIT */}
				{step === 5 && (
					<section className="card overflow-hidden">
						<div className="border-b border-surface-100 px-5 py-4 sm:px-6">
							<h2 className="section-title flex items-center gap-2">
								<ShoppingCart size={18} className="text-brand-600" /> Send
								the order
							</h2>
							<p className="mt-1 text-sm text-surface-500">
								The order is released for loading straight away. Scan the QR
								codes from the mobile app to load it.
							</p>
						</div>
						<div className="space-y-4 p-5 sm:p-6">
							{createdOrderId ? (
								<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
									<CheckCircle2 size={28} className="mx-auto text-emerald-600" />
									<p className="mt-3 text-sm font-semibold text-emerald-800">
										Order #{createdOrderId} is ready to load.
									</p>
									<p className="mt-1 text-xs text-emerald-700">
										Download the packing list, then scan the QR codes from the
										mobile app to load the truck.
									</p>
									<div className="mt-4 flex flex-wrap justify-center gap-2">
										<button
											type="button"
											className="btn-secondary btn-sm"
											onClick={() => {
												setCreatedOrderId(null);
												setStep(1);
											}}
										>
											<Plus size={14} /> Create another order
										</button>
									</div>
								</div>
							) : (
								<div className="rounded-xl border border-surface-200 bg-surface-50 p-5">
									<p className="text-sm font-semibold text-surface-900">
										{selectedUnits.toLocaleString()} units for{" "}
										{selectedClient?.name || "the selected customer"}
									</p>
									<p className="mt-1 text-xs text-surface-500">
										{selectedLines.length} product line
										{selectedLines.length === 1 ? "" : "s"} from{" "}
										{selectedGroups.length} batch
										{selectedGroups.length === 1 ? "" : "es"}.
									</p>
									<ul className="mt-3 space-y-1.5">
										{selectedGroups.map((group) => (
											<li
												key={group.key}
												className="flex items-center justify-between gap-3 text-xs"
											>
												<span className="truncate font-mono text-surface-700">
													{group.batchNumber}
												</span>
												<span className="shrink-0 text-surface-500">
													{group.lines.reduce(
														(sum, line) =>
															sum + Number(quantities[line.key] || 0),
														0,
													).toLocaleString()}{" "}
													units · {group.lines.length} line
													{group.lines.length === 1 ? "" : "s"}
												</span>
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					</section>
				}

                                <div className="mt-4 row-gap-2 row-cols-1 row-cols-sm-2 row-cols-lg-4">
                                    <label className="input-label col-span-12 sm:col-span-6">
                                        Scheduled Dispatch *
                                    </label>
                                    <div className="col-span-12 sm:col-span-6">
                                        <input
                                            id="scheduled-dispatch-at"
                                            type="datetime-local"
                                            className="input w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                                            value={scheduledDispatchAtString || ''}
                                            onChange={(e) => setScheduledDispatchAtString(e.target.value)}
                                            placeholder="e.g. 2025-01-15T14:30"
                                        />
                                        <AppText variant="caption" className="mt-1 text-[10px] text-surface-500">
                                            Planned date & time the load leaves the plant.
                                        </AppText>
                                    </div>
                                </div>
				)}

				{/* Wizard footer */}
				{!(step === 5 && createdOrderId) && (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<button
							type="button"
							className="btn-secondary"
							onClick={() => setStep((current) => Math.max(1, current - 1))}
							disabled={step === 1 || saving}
						>
							<ArrowLeft size={15} /> Back
						</button>
						{step < 5 ? (
							<button
								type="button"
								className="btn-primary"
								onClick={() => setStep((current) => Math.min(5, current + 1))}
								disabled={!canContinue}
							>
								Continue <ArrowRight size={15} />
							</button>
						) : (
							<button type="submit" className="btn-primary" disabled={saving}>
								{saving ? (
									<Loader2 size={15} className="animate-spin" />
								) : (
									<ClipboardList size={15} />
								)}
								{saving ? "Sending..." : "Create the order"}
							</button>
						)}
					</div>
				)}
			</form>

			{/* MY ORDERS */}
			<section className="card overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-100 px-5 py-4 sm:px-6">
					<div>
						<h2 className="section-title flex items-center gap-2">
							<FileText size={18} className="text-brand-600" /> My dispatch
							orders
						</h2>
						<p className="mt-1 text-sm text-surface-500">
							Download packing lists, start loading, and cancel an order
							before it goes on the truck.
						</p>
					</div>
				</div>
				{orders.length === 0 ? (
					<div className="px-6 py-12 text-center">
						<ShoppingCart size={24} className="mx-auto text-surface-300" />
						<p className="mt-3 text-sm font-semibold text-surface-800">
							No dispatch orders yet
						</p>
						<p className="mt-1 text-xs text-surface-500">
							Orders you create will appear here.
						</p>
					</div>
				) : (
					<ul className="divide-y divide-surface-100">
						{orders.map((order: any) => {
							const status = orderStatus(order);
							const approved = String(order.status || "").toUpperCase() === "APPROVED";
							return (
								<li
									key={order.id}
									className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-bold text-surface-900">
												Order #{order.id}
											</span>
											<span
												className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${status.style}`}
											>
												{status.label}
											</span>
										</div>
										<p className="mt-1 text-xs text-surface-500">
											{order.client_name || "Customer"} ·{" "}
											{Number(order.quantity || 0).toLocaleString()} units
											{order.items?.length > 1
												? ` · ${order.items.length} product lines`
												: ""}
										</p>
									</div>
									<div className="flex flex-wrap gap-2">
										{approved && (
											<button
												type="button"
												className="btn-primary btn-sm"
												onClick={() =>
													navigate(
														`/dispatch?order=${encodeURIComponent(order.id)}`,
													)
												}
											>
												<ScanLine size={13} /> Load & Scan
											</button>
										)}
										{approved && cancellingId !== String(order.id) && (
											<button
												type="button"
												className="btn-secondary btn-sm text-rose-600"
												onClick={() => {
													setCancellingId(String(order.id));
													setCancelReason("");
												}}
											>
												<XCircle size={13} /> Cancel
											</button>
										)}
										{(approved ||
											String(order.status || "").toUpperCase() ===
												"CLOSED_DISPATCHED" ||
											String(order.status || "").toUpperCase() ===
												"CLOSED_NOT_DISPATCHED") && (
											<>
												<button
													type="button"
													className="btn-secondary btn-sm"
													onClick={() =>
														navigate(
															`/packing-list?order=${encodeURIComponent(order.id)}`,
														)
													}
												>
													<FileText size={13} /> Packing list
												</button>
												<button
													type="button"
													className="btn-ghost btn-sm"
													onClick={() => void downloadPdf(order)}
												>
													<Download size={13} /> PDF
												</button>
											</>
										)}
									</div>
									{cancellingId === String(order.id) && (
										<div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
											<input
												className="input h-10 flex-1 text-sm"
												placeholder="Reason for cancelling (required)"
												value={cancelReason}
												onChange={(event) => setCancelReason(event.target.value)}
												aria-label={`Reason for cancelling order ${order.id}`}
											/>
											<button
												type="button"
												className="btn-secondary btn-sm text-rose-600"
												disabled={saving || !cancelReason.trim()}
												onClick={() => void cancelOrder(order)}
											>
												Confirm cancel
											</button>
											<button
												type="button"
												className="btn-ghost btn-sm"
												disabled={saving}
												onClick={() => {
													setCancellingId(null);
													setCancelReason("");
												}}
											>
												Keep
											</button>
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</section>
				}

                                <div className="mt-4 row-gap-2 row-cols-1 row-cols-sm-2 row-cols-lg-4">
                                    <label className="input-label col-span-12 sm:col-span-6">
                                        Scheduled Dispatch *
                                    </label>
                                    <div className="col-span-12 sm:col-span-6">
                                        <input
                                            id="scheduled-dispatch-at"
                                            type="datetime-local"
                                            className="input w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                                            value={scheduledDispatchAtString || ''}
                                            onChange={(e) => setScheduledDispatchAtString(e.target.value)}
                                            placeholder="e.g. 2025-01-15T14:30"
                                        />
                                        <AppText variant="caption" className="mt-1 text-[10px] text-surface-500">
                                            Planned date & time the load leaves the plant.
                                        </AppText>
                                    </div>
                                </div>
		</div>
	);
}
