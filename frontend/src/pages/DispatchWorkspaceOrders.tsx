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
	RotateCcw,
	ScanLine,
	Search,
	ShoppingCart,
	Truck,
	Users,
	X,
	XCircle,
} from "lucide-react";
import { api } from "../services/api";
import { subscribe } from "../services/realtime";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { EntityId } from "../types";
import {
	availableFor,
	buildBatchGroups,
	type ProductLine,
} from "../utils/batchGroups";
import QrChipPicker, { type QrLabelChip } from "../components/QrChipPicker";
import DateTimePicker from "../components/DateTimePicker";

function operationId(): string {
	return typeof crypto !== "undefined" && crypto.randomUUID
		? crypto.randomUUID()
		: `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const STEPS = [
	{ id: 1, title: "Select customer", icon: Users },
	{ id: 2, title: "Select printed batches", icon: Package },
	{ id: 3, title: "Review QR codes", icon: ClipboardList },
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
	const [qrLabels, setQrLabels] = useState<Record<string, QrLabelChip[]>>({});
	const [selectedLabels, setSelectedLabels] = useState<Record<string, string[]>>({});
	const [qrLabelsError, setQrLabelsError] = useState(false);
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
	// Post-seal recall: pull a unit from the sealed container and reopen the
	// same order for replacement loading.
	const [recallOrder, setRecallOrder] = useState<any>(null);
	const [recallSessionId, setRecallSessionId] = useState<EntityId | null>(null);
	const [recallPending, setRecallPending] = useState(0);
	const [recallQr, setRecallQr] = useState("");
	const [recallReason, setRecallReason] = useState("");
	const [recallCondition, setRecallCondition] = useState<"DAMAGED" | "HOLD" | "RETURN_TO_STOCK">("DAMAGED");
	const [recallBusy, setRecallBusy] = useState(false);
	const [recallReloadBusy, setRecallReloadBusy] = useState(false);
	// Transporter details travel with the order and end up on the packing list.
	const [transporterName, setTransporterName] = useState("");
	const [transporterMobile, setTransporterMobile] = useState("");
	const [vehicleNumber, setVehicleNumber] = useState("");
	const [containerNumber, setContainerNumber] = useState("");
	const [scheduledDispatchAtString, setScheduledDispatchAtString] = useState("");
	const debouncedSearch = useDebouncedValue(search, 250);
	const debouncedClientSearch = useDebouncedValue(clientSearch, 250);

	const load = useCallback(async () => {
		setError("");
		try {
			const [readyBatches, clientRows, orderRows] = await Promise.all([
				api.batches.recent({ status: "QC_PASSED", limit: 100 }),
				api.clients.list(),
				api.dispatchOrders.mine(),
			]);
			// Only QC-passed batches whose QR labels have been printed can be
			// put on a truck.
			const ready = readyBatches.filter(
				(row: any) =>
					String(row.status || "").toUpperCase() === "QC_PASSED" &&
					row.qr_printed === true &&
					Number(row.available_quantity ?? row.quantity ?? 0) > 0,
			);
			setBatches(ready);
			// Pull the pickable QR labels for exactly the batches on screen so
			// the chip picker in step 2 can show the codes without a per-batch
			// round trip.
			const labelBatchIds = [...new Set(ready.map((row: any) => row.id).filter((id: any) => id !== null && id !== undefined))];
			if (labelBatchIds.length > 0) {
				try {
					const available = await api.dispatchOrders.availableQrLabels(labelBatchIds);
					const grouped: Record<string, QrLabelChip[]> = {};
					for (const label of available) {
						(grouped[String(label.batch_id)] ??= []).push(label);
					}
					setQrLabels(grouped);
					setQrLabelsError(false);
				} catch {
					// The picker is a convenience — surface the failure so the user
					// knows why no chips appear, and can retry with Refresh.
					setQrLabels({});
					setQrLabelsError(true);
				}
			} else {
				setQrLabels({});
				setQrLabelsError(false);
			}
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
		const unsubscribe = subscribe((event) => {
			if (event.type === 'qc.decision' || event.type === 'batch.created' || event.type === 'batch.printed' || event.type === 'dispatch.order-status' || event.type === 'dispatch.loading-opened' || event.type === 'dispatch.loading-closed' || event.type === 'dispatch.loading-recalled' || event.type === 'dispatch.loading-reopened') {
				void load();
			}
		});
		return () => unsubscribe();
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
	/** All pickable QR labels for one line, flattened over its unit batches. */
	const labelsForLine = useCallback(
		(line: ProductLine): QrLabelChip[] =>
			line.units
				.flatMap((unit) => qrLabels[String(unit.id)] ?? [])
				.slice()
				.sort((a, b) =>
					new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare(a.qr_value, b.qr_value),
				),
		[qrLabels],
	);
	const linePickCount = (key: string) => selectedLabels[key]?.length ?? 0;
	const setAllLineLabels = (lineKey: string, labelIds: string[]) => {
		setSelectedLabels((current) => ({ ...current, [lineKey]: labelIds }));
	};
	/**
	 * The quantity stepper and the chip picker both drive the same selection.
	 * Raising the stepper auto-picks the next available codes; lowering it trims
	 * from the end of the picked list; clicking chips always wins and updates the
	 * stepper to the picked count.
	 */
	const setQuantity = (line: ProductLine, raw: string) => {
		const all = labelsForLine(line);
		const total = all.length;
		const value = raw === "" ? 1 : Math.max(1, Math.min(total, Math.floor(Number(raw) || 1)));
		setSelectedLabels((current) => {
			const picked = current[line.key] ?? [];
			if (value > picked.length) {
				const have = new Set(picked);
				const additions = all
					.filter((label) => !have.has(String(label.id)))
					.slice(0, value - picked.length)
					.map((label) => String(label.id));
				return { ...current, [line.key]: [...picked, ...additions] };
			}
			return { ...current, [line.key]: picked.slice(0, value) };
		});
	};
	const adjustQuantity = (line: ProductLine, delta: number) => {
		setQuantity(line, String(linePickCount(line.key) + delta));
	};
	const quantityStepper = (line: ProductLine) => {
		const qty = linePickCount(line.key);
		const label = line.name || line.sku || "product";
		const total = labelsForLine(line).length;
		return (
			<div className="flex items-center gap-2">
				<button
					type="button"
					className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-200 text-surface-600 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label={`Decrease quantity for ${label}`}
					disabled={qty <= 1}
					onClick={() => adjustQuantity(line, -1)}
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
					onChange={(event) => setQuantity(line, event.target.value)}
				/>
				<button
					type="button"
					className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-200 text-surface-600 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label={`Increase quantity for ${label}`}
					disabled={qty >= total}
					onClick={() => adjustQuantity(line, 1)}
				>
					<Plus size={16} />
				</button>
				<span className="w-20 text-right text-xs text-surface-500">
					max {total}
				</span>
			</div>
		);
	};
	const selectedUnits = selectedLines.reduce(
		(sum, line) => sum + linePickCount(line.key),
		0,
	);
	const allSelectedLinesPicked = selectedLineKeys.every(
		(key) => (selectedLabels[key]?.length ?? 0) > 0,
	);
	const toggleLineLabel = (lineKey: string, labelId: string) => {
		setSelectedLabels((current) => {
			const picked = new Set(current[lineKey] ?? []);
			if (picked.has(labelId)) picked.delete(labelId);
			else picked.add(labelId);
			return { ...current, [lineKey]: [...picked] };
		});
	};
	// When QR labels finish loading after a line was already picked, fill in the
	// default selection (everything available) for lines that have none yet.
	useEffect(() => {
		setSelectedLabels((current) => {
			let changed = false;
			const next = { ...current };
			for (const key of selectedLineKeys) {
				if (next[key]?.length) continue;
				const line = lineByKey.get(key);
				if (!line) continue;
				const ids = labelsForLine(line).map((label) => String(label.id));
				if (ids.length) {
					next[key] = ids;
					changed = true;
				}
			}
			return changed ? next : current;
		});
	}, [qrLabels, selectedLineKeys, lineByKey, labelsForLine]);

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

	/**
	 * Toggle a product line: picking it defaults to every available QR code of
	 * the line (the previous default of "all units"), and unpicking clears the
	 * hand-picked codes.
	 */
	const toggleLine = (line: ProductLine) => {
		const key = line.key;
		if (selectedLineKeys.includes(key)) {
			setSelectedLineKeys((current) => current.filter((value) => value !== key));
			setSelectedLabels((values) => {
				const next = { ...values };
				delete next[key];
				return next;
			});
		} else {
			setSelectedLineKeys((current) => [...current, key]);
			setSelectedLabels((values) =>
				values[key]
					? values
					: { ...values, [key]: labelsForLine(line).map((label) => String(label.id)) },
			);
		}
	};

	/**
	 * The order is still raised per unit batch, because each unit carries its
	 * own QR label. Each unit batch becomes one line item carrying exactly the
	 * QR codes the picker chose — the server reserves those very labels.
	 */
	const buildOrderItems = () => {
		const items: Array<{ batch_id: EntityId; quantity: number; label_ids: EntityId[] }> = [];
		for (const line of selectedLines) {
			const picked = new Set(selectedLabels[line.key] ?? []);
			for (const unit of line.units) {
				const chosen = (qrLabels[String(unit.id)] ?? [])
					.filter((label) => picked.has(String(label.id)))
					.map((label) => label.id as EntityId);
				if (chosen.length > 0) {
					items.push({ batch_id: unit.id as EntityId, quantity: chosen.length, label_ids: chosen });
				}
			}
		}
		return items;
	};

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
			setMessage(`Order #${order.order_number || order.id} was cancelled and the stock is free again.`);
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

	/** Look up the closed (sealed) session of an order and open the recall modal. */
	const openRecallModal = async (order: any) => {
		setRecallOrder(order);
		setRecallSessionId(null);
		setRecallPending(0);
		setRecallQr("");
		setRecallReason("");
		setRecallCondition("DAMAGED");
		setError("");
		setMessage("");
		setRecallBusy(true);
		try {
			const info = await api.loadingSessions.byOrder(order.id);
			setRecallSessionId(info.session_id ?? null);
			setRecallPending(Number(info.reload_pending ?? 0));
			if (!info.session_id) {
				setError("No sealed loading session found for this order.");
			}
		} catch (err: any) {
			setError(err.message || "Could not look up the sealed session for this order");
			setRecallOrder(null);
		} finally {
			setRecallBusy(false);
		}
	};

	/** Mark one QR unit inside the sealed container as recalled. */
	const handleRecallSealed = async () => {
		if (!recallSessionId) {
			setError("No sealed loading session found for this order.");
			return;
		}
		if (!recallQr.trim() || !recallReason.trim()) {
			setError("Enter the QR code and a reason for the recall.");
			return;
		}
		setRecallBusy(true);
		setError("");
		try {
			const result = await api.loadingSessions.recallSealed(recallSessionId, {
				qr_value: recallQr.trim(),
				condition: recallCondition,
				reason: recallReason.trim(),
			});
			setRecallPending(Number(result?.reload_pending ?? 0));
			setRecallQr("");
			setRecallReason("");
			setMessage('Sealed unit recalled. Use "Reload new product" to reopen this order for replacement loading.');
		} catch (err: any) {
			setError(err.message || "Could not recall the sealed unit");
		} finally {
			setRecallBusy(false);
		}
	};

	/** Reopen the same dispatch order for the replacement units. */
	const handleReloadOrder = async () => {
		if (!recallSessionId) {
			setError("No sealed loading session found for this order.");
			return;
		}
		setRecallReloadBusy(true);
		setError("");
		try {
			const result = await api.loadingSessions.reload(recallSessionId);
			const short = Number(result?.unfilled_units ?? 0);
			setMessage(`Order ${result?.order_number ?? result?.order_id} reopened for ${Number(result?.quantity ?? 0)} replacement unit(s).${short > 0 ? ` Warning: ${short} unit(s) have no spare printed label — print more labels for the batch before loading.` : ' Use "Load & Scan" to scan the new product.'}`);
			setRecallOrder(null);
			await load();
		} catch (err: any) {
			setError(err.message || "Could not reload this order");
		} finally {
			setRecallReloadBusy(false);
		}
	};

	const createOrder = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		const items = buildOrderItems();
		if (!items.length || !clientId || !allSelectedLinesPicked) {
			setError("Select at least one batch, pick at least one QR code per line, and choose a customer.");
			return;
		}
		if (!transporterComplete) {
			setError("Add the transporter name, mobile number, vehicle number and container number.");
			return;
		}
		if (!scheduledDispatchAtString) {
			setError("Enter the scheduled dispatch date and time.");
			return;
		}
		const scheduledDispatchAt = new Date(scheduledDispatchAtString);
		if (Number.isNaN(scheduledDispatchAt.getTime())) {
			setError("Enter a valid scheduled dispatch date and time.");
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
				scheduled_dispatch_at: scheduledDispatchAt.toISOString(),
				client_operation_id: operationId(),
			});
			const orderId = result?.order_number ?? result?.id ?? result?.entityId;
			if (!orderId) throw new Error("The order was not created. Refresh and try again.");
			setCreatedOrderId(String(orderId));
			setSelectedLineKeys([]);
			setClientId("");
			setSelectedLabels({});
			setTransporterName("");
			setTransporterMobile("");
			setVehicleNumber("");
			setContainerNumber("");
			setScheduledDispatchAtString("");
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
				? selectedLineKeys.length > 0 && allSelectedLinesPicked
				: step === 4
						? Boolean(transporterComplete && scheduledDispatchAtString)
					: true;



	return (
		<div className="page-container space-y-6">
			<header className="page-header">
				<div>
					<p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-600">
						Dispatch workspace
					</p>
					<h1 className="page-title mt-1">Create a dispatch order</h1>
					<p className="page-subtitle">
						Pick the customer, tap the exact QR codes going on the order,
						and send it for loading.
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
					className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
				>
					<span>{error}</span>
					<button
						type="button"
						aria-label="Dismiss error"
						className="shrink-0 rounded-md p-1 text-rose-500 transition hover:bg-rose-100 hover:text-rose-700"
						onClick={() => setError("")}
					>
						<X size={16} />
					</button>
				</div>
			)}
			{message && (
				<div
					role="status"
					className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"
				>
					<span>{message}</span>
					<button
						type="button"
						aria-label="Dismiss message"
						className="shrink-0 rounded-md p-1 text-emerald-600 transition hover:bg-emerald-100 hover:text-emerald-800"
						onClick={() => setMessage("")}
					>
						<X size={16} />
					</button>
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
											(sum, line) => sum + linePickCount(line.key),
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
																				{line.grade}
																			</p>
																			<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-surface-500">
																				{/* {line.grade && (
																					<span className="font-medium text-surface-600">
																						{line.grade}
																					</span>
																				)} */}
																				<span className="font-medium text-surface-600">
																						{label}
																					</span>
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
																		<div className="space-y-3 border-t border-surface-100 bg-white px-4 py-3">
																			<div className="flex flex-wrap items-center justify-between gap-3">
																				<span className="text-xs font-bold uppercase tracking-wide text-surface-500">
																					Quantity to dispatch
																				</span>
																				{quantityStepper(line)}
																			</div>
																			<QrChipPicker
																				labels={labelsForLine(line)}
																				selectedIds={selectedLabels[line.key] ?? []}
																				onToggle={(id) => toggleLineLabel(line.key, id)}
																				onSelectAll={() => setAllLineLabels(line.key, labelsForLine(line).map((label) => String(label.id)))}
																				onClear={() => setAllLineLabels(line.key, [])}
																				loadError={qrLabelsError}
																			/>
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
							{selectedLineKeys.length > 0 && !allSelectedLinesPicked && (
							<p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
								Pick at least one QR code for every selected line — tap the chips above each line.
							</p>
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
				)}

				{/* STEP 3 - QR CODES */}
				{step === 3 && (
					<section className="card overflow-hidden">
						<div className="border-b border-surface-100 px-5 py-4 sm:px-6">
							<h2 className="section-title flex items-center gap-2">
								<ClipboardList size={18} className="text-brand-600" /> Review
								the QR codes
							</h2>
							<p className="mt-1 text-sm text-surface-500">
								These exact codes go on the order, and nothing can be changed here —
								go back to step 2 to change the selection.
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
												(sum, line) => sum + linePickCount(line.key),
												0,
											).toLocaleString()}{" "}
											units
										</span>
									</div>
									<ul className="divide-y divide-surface-100">
										{group.lines.map((line) => {
											const lineLabels = labelsForLine(line);
											const picked = selectedLabels[line.key] ?? [];
											const pickedSet = new Set(picked);
											const chosen = lineLabels.filter((label) => pickedSet.has(String(label.id)));
											const remaining = lineLabels.length - chosen.length;
											return (
											<li
												key={line.key}
												className="flex flex-col gap-3 px-5 py-4 sm:px-6"
											>
												<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
																	{line.locations.length > 1 ? ` +${line.locations.length - 1}` : ""}
																</span>
															)}
														</p>
													</div>
													<div className="shrink-0 sm:text-right">
														<span className="block text-xl font-black tabular-nums text-surface-900">
															{chosen.length.toLocaleString()}{" "}
															<span className="text-xs font-bold text-surface-500">units</span>
														</span>
														<span className="block text-[11px] font-semibold uppercase tracking-wide text-surface-400">
															{chosen.length} of {lineLabels.length} codes selected
														</span>
													</div>
												</div>
												<div className="flex flex-wrap gap-2">
													{chosen.map((label) => (
														<span
															key={String(label.id)}
															className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-4 py-2 font-mono text-xs font-semibold text-brand-800"
														>
															<Check size={13} strokeWidth={3} />
															{label.qr_value}
														</span>
													))}
												</div>
												{remaining > 0 && (
													<p className="text-[11px] text-surface-400">
														{remaining} of {lineLabels.length} codes not selected - they stay in stock.
														Go back to step 2 to change the selection.
													</p>
												)}
											</li>
											);
										})}
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
							<div className="mt-4">
								<label className="input-label" htmlFor="scheduled-dispatch-at">
									Scheduled Dispatch *
								</label>
								<DateTimePicker
									id="scheduled-dispatch-at"
									value={scheduledDispatchAtString || ""}
									onChange={setScheduledDispatchAtString}
									required
									placeholder="Pick the dispatch date and time"
								/>
								<p className="mt-1 text-[10px] text-surface-500">
									Planned date &amp; time the load leaves the plant.
								</p>
							</div>
						</div>
					</section>
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
								<div className="relative rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
									<button
										type="button"
										aria-label="Dismiss order confirmation"
										className="absolute right-3 top-3 rounded-md p-1 text-emerald-600 transition hover:bg-emerald-100 hover:text-emerald-800"
										onClick={() => {
											setCreatedOrderId(null);
											setMessage("");
											setStep(1);
										}}
									>
										<X size={16} />
									</button>
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
															sum + linePickCount(line.key),
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
							const closed = ["CLOSED_DISPATCHED", "CLOSED_NOT_DISPATCHED"].includes(String(order.status || "").toUpperCase());
							return (
								<li
									key={order.id}
									className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-bold text-surface-900">
												Order #{order.order_number || order.id}
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
										{closed && (
											<button
												type="button"
												className="btn-secondary btn-sm text-amber-700"
												onClick={() => void openRecallModal(order)}
											>
												<RotateCcw size={13} /> Recall Unit
											</button>
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

			{/* RECALL SEALED UNIT MODAL */}
			{recallOrder && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
					<div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-xl overflow-hidden">
						<div className="p-5 border-b border-slate-100 flex items-center justify-between">
							<div>
								<h2 className="text-lg font-bold text-slate-900">Recall Sealed Unit</h2>
								<p className="text-xs text-slate-500 mt-0.5">
									Order #{recallOrder.order_number || recallOrder.id} · {recallOrder.product_name}{' '}
									· Seal: <span className="font-mono">{recallOrder.seal_number || 'recorded on session'}</span>
								</p>
							</div>
							<button
								type="button"
								onClick={() => setRecallOrder(null)}
								disabled={recallBusy || recallReloadBusy}
								className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
							>
								<X size={20} />
							</button>
						</div>

						<div className="p-6 space-y-4">
							{!recallSessionId && !recallBusy && (
								<p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
									No sealed loading session was found for this order, so there is nothing to recall.
								</p>
							)}
							<p className="text-sm font-medium text-slate-600">
								Scan or enter the QR code of the unit to pull from the sealed container. The unit is
								marked recalled; if it must be replaced, reload the order and load a new QR label
								against the same order.
							</p>
							<div className="grid gap-2 sm:grid-cols-2">
								<input
									className="input font-mono text-sm sm:col-span-2"
									value={recallQr}
									onChange={(event) => setRecallQr(event.target.value)}
									placeholder="Scan or enter the sealed unit's QR code"
									autoComplete="off"
									aria-label="Sealed unit QR code"
								/>
								<select
									className="input sm:col-span-2"
									value={recallCondition}
									onChange={(event) => setRecallCondition(event.target.value as typeof recallCondition)}
									aria-label="Recall condition"
								>
									<option value="DAMAGED">Damaged</option>
									<option value="HOLD">Hold for review</option>
									<option value="RETURN_TO_STOCK">Return to stock</option>
								</select>
								<input
									className="input sm:col-span-2"
									value={recallReason}
									onChange={(event) => setRecallReason(event.target.value)}
									placeholder="Describe why this sealed unit is being recalled"
									aria-label="Recall reason"
								/>
							</div>
							{recallPending > 0 && (
								<p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
									{recallPending} replacement unit(s) pending for this order. Reloading reopens the
									order as ready for loading with just the recalled quantities.
								</p>
							)}
						</div>
						<div className="p-5 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setRecallOrder(null)}
								disabled={recallBusy || recallReloadBusy}
								className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
							>
								Close
							</button>
							<button
								type="button"
								onClick={handleRecallSealed}
								disabled={recallBusy || recallReloadBusy || !recallSessionId || !recallQr.trim() || !recallReason.trim()}
								className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm disabled:opacity-50"
							>
								<RotateCcw size={16} /> {recallBusy ? 'Recalling...' : 'Recall Sealed Unit'}
							</button>
							<button
								type="button"
								onClick={handleReloadOrder}
								disabled={recallBusy || recallReloadBusy || recallPending < 1 || !recallSessionId}
								className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
							>
								<Truck size={16} />
								{recallReloadBusy
									? 'Reloading...'
									: `Reload new product${recallPending > 0 ? ` (${recallPending})` : ''}`}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
