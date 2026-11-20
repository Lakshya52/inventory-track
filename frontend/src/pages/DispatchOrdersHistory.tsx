import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
	ArrowLeft,
	ChevronLeft,
	ChevronRight,
	ClipboardList,
	Download,
	FileText,
	Loader2,
	RotateCcw,
	Search,
	ShieldCheck,
	X,
} from "lucide-react";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { EntityId } from "../types";
import { RECALL_CONDITIONS } from "../utils/recallConditions";
import { formatDateTime } from "../utils/dateFormat";

type OrderRow = Record<string, any>;

function statusBadge(order: OrderRow) {
	switch (String(order?.status || "").toUpperCase()) {
		case "APPROVED":
			return { label: "Ready to load", className: "bg-emerald-50 text-emerald-700" };
		case "CANCELLED":
		case "REJECTED":
			return { label: "Cancelled", className: "bg-rose-50 text-rose-700" };
		case "CLOSED_DISPATCHED":
			return { label: "Dispatched", className: "bg-emerald-50 text-emerald-700" };
		case "CLOSED_NOT_DISPATCHED":
			return { label: "Not dispatched", className: "bg-slate-100 text-slate-600" };
		default:
			return { label: String(order?.status || "Unknown"), className: "bg-slate-100 text-slate-600" };
	}
}

const PAGE_SIZES = [10, 25, 50, 100];

export default function DispatchOrdersHistory() {
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 250);
	const [status, setStatus] = useState("");
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(25);
	const [items, setItems] = useState<OrderRow[]>([]);
	const [total, setTotal] = useState(0);
	const [pages, setPages] = useState(1);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");

	// Seal + recall dialogs (same actions as the create-order screen).
	const [sealOrder, setSealOrder] = useState<OrderRow | null>(null);
	const [sealSessionId, setSealSessionId] = useState<EntityId | null>(null);
	const [sealValue, setSealValue] = useState("");
	const [sealBusy, setSealBusy] = useState(false);
	const [sealLoading, setSealLoading] = useState(false);
	const [recallOrder, setRecallOrder] = useState<OrderRow | null>(null);
	const [recallSessionId, setRecallSessionId] = useState<EntityId | null>(null);
	const [recallQr, setRecallQr] = useState("");
	const [recallReason, setRecallReason] = useState("");
	const [recallCondition, setRecallCondition] = useState<"DAMAGED" | "HOLD" | "RETURN_TO_STOCK">("DAMAGED");
	const [recallBusy, setRecallBusy] = useState(false);
	const [recalling, setRecalling] = useState(false);
	const [reloading, setReloading] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			const result = await api.dispatchOrders.history({
				q: debouncedSearch.trim() || undefined,
				status: status || undefined,
				page,
				limit: pageSize,
			});
			setItems(result.items || []);
			setTotal(result.total);
			setPages(result.pages);
			if (result.page > result.pages && result.pages > 0) setPage(result.pages);
		} catch (err: any) {
			setError(err?.message || "Could not load dispatch orders");
		} finally {
			setLoading(false);
		}
	}, [debouncedSearch, status, page, pageSize]);

	useEffect(() => { void load(); }, [load]);

	const pageButtons = useMemo<(number | string)[]>(() => {
		if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
		const start = Math.max(2, Math.min(page - 2, pages - 5));
		const end = Math.min(pages - 1, start + 4);
		const buttons: (number | string)[] = [1];
		if (start > 2) buttons.push("…");
		for (let p = start; p <= end; p += 1) buttons.push(p);
		if (end < pages - 1) buttons.push("…");
		buttons.push(pages);
		return buttons;
	}, [page, pages]);

	const openSealModal = async (order: OrderRow) => {
		setSealOrder(order);
		setSealSessionId(null);
		setSealValue(order.seal_number ?? "");
		setError("");
		setMessage("");
		setSealLoading(true);
		try {
			const info = await api.loadingSessions.byOrder(order.id);
			setSealSessionId(info.session_id ?? null);
			setSealValue(info.seal_number ?? order.seal_number ?? "");
			if (!info.session_id) setError("No sealed loading session found for this order.");
		} catch (err: any) {
			setError(err?.message || "Could not look up the sealed session");
			setSealOrder(null);
		} finally {
			setSealLoading(false);
		}
	};

	const saveSeal = async () => {
		if (!sealOrder || !sealSessionId || sealBusy) return;
		setSealBusy(true);
		setError("");
		try {
			const result = await api.loadingSessions.setSeal(sealSessionId, sealValue.trim());
			setItems((current) => current.map((order) =>
				String(order.id) === String(sealOrder.id) ? { ...order, seal_number: result.seal_number } : order,
			));
			setMessage(result.seal_number ? `Seal number saved for order #${sealOrder.order_number || sealOrder.id}.` : "Seal number cleared.");
			setSealOrder(null);
		} catch (err: any) {
			setError(err?.message || "Could not save the seal number");
		} finally {
			setSealBusy(false);
		}
	};

	const openRecallModal = async (order: OrderRow) => {
		setRecallOrder(order);
		setRecallSessionId(null);
		setRecallQr("");
		setRecallReason("");
		setRecallCondition("DAMAGED");
		setError("");
		setMessage("");
		setRecallBusy(true);
		try {
			const info = await api.loadingSessions.byOrder(order.id);
			setRecallSessionId(info.session_id ?? null);
			if (!info.session_id) setError("No sealed loading session found for this order.");
		} catch (err: any) {
			setError(err?.message || "Could not look up the sealed session");
			setRecallOrder(null);
		} finally {
			setRecallBusy(false);
		}
	};

	const recallUnit = async () => {
		if (!recallSessionId || !recallQr.trim() || !recallReason.trim() || recalling) return;
		setRecalling(true);
		setError("");
		try {
			await api.loadingSessions.recallSealed(recallSessionId, {
				qr_value: recallQr.trim(),
				condition: recallCondition,
				reason: recallReason.trim(),
			});
			setMessage("Sealed unit recalled. Use Reload to load a replacement against this order.");
			setRecallOrder(null);
			void load();
		} catch (err: any) {
			setError(err?.message || "Could not recall the sealed unit");
		} finally {
			setRecalling(false);
		}
	};

	const reloadOrder = async () => {
		if (!recallSessionId || reloading) return;
		setReloading(true);
		setError("");
		try {
			const result = await api.loadingSessions.reload(recallSessionId);
			setMessage(`Order ${result?.order_number ?? result?.order_id} reopened for ${Number(result?.quantity ?? 0)} replacement unit(s).`);
			setRecallOrder(null);
			void load();
		} catch (err: any) {
			setError(err?.message || "Could not reload the order");
		} finally {
			setReloading(false);
		}
	};

	const downloadPdf = async (order: OrderRow) => {
		setError("");
		try {
			await api.dispatchOrders.downloadPackingListPdf(order.id, `packing-list-${order.batch_number || order.id}.pdf`);
		} catch (err: any) {
			setError(err?.message || "Could not download the packing list");
		}
	};

	return (
		<div className="page-container mx-auto max-w-7xl space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
							<ClipboardList size={20} />
						</div>
						<h1 className="text-2xl font-bold text-slate-900">Dispatch Orders History</h1>
					</div>
					<p className="ml-[52px] text-base text-slate-500">
						Search every dispatch order, download packing lists, manage seals and recall sealed units.
					</p>
				</div>
				<Link to="/dispatch-orders" className="btn-secondary btn-sm">
					<ArrowLeft size={14} /> Create order
				</Link>
			</div>

			<div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-xs">
				<div className="relative min-w-[220px] flex-1">
					<Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
					<input
						className="input pl-9"
						placeholder="Search order number, batch, client or grade…"
						value={search}
						onChange={(event) => { setSearch(event.target.value); setPage(1); }}
					/>
				</div>
				<select
					className="input min-w-[180px]"
					aria-label="Status filter"
					value={status}
					onChange={(event) => { setStatus(event.target.value); setPage(1); }}
				>
					<option value="">All statuses</option>
					<option value="APPROVED">Ready to load</option>
					<option value="CLOSED_DISPATCHED">Dispatched</option>
					<option value="CLOSED_NOT_DISPATCHED">Not dispatched</option>
					<option value="CANCELLED">Cancelled</option>
				</select>
				<select
					className="input w-24"
					aria-label="Orders per page"
					value={pageSize}
					onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
				>
					{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
				</select>
				<span className="text-xs font-semibold text-slate-500">{total.toLocaleString()} orders</span>
			</div>

			{error && (
				<div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
					{error}
				</div>
			)}
			{message && (
				<div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
					{message}
				</div>
			)}

			<section className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xs">
				<div className="border-b border-slate-100 px-5 py-4">
					<h2 className="text-lg font-bold text-slate-900">All dispatch orders</h2>
				</div>
				{loading && items.length === 0 ? (
					<div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-slate-500">
						<Loader2 size={18} className="animate-spin" /> Loading orders…
					</div>
				) : items.length === 0 ? (
					<div className="px-5 py-14 text-center text-sm text-slate-500">No orders match these filters.</div>
				) : (
					<ul className="divide-y divide-slate-100">
						{items.map((order) => {
							const badge = statusBadge(order);
							const closed = ["CLOSED_DISPATCHED", "CLOSED_NOT_DISPATCHED"].includes(String(order.status || "").toUpperCase());
							return (
								<li key={order.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-bold text-slate-900">
												Order #{order.order_number || order.id}
											</span>
											<span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badge.className}`}>
												{badge.label}
											</span>
										</div>
										<p className="mt-1 text-xs text-surface-500">
											{order.grade_name || order.product_name || "Grade"} · {order.client_name || "Client"} ·{" "}
											{Number(order.quantity || 0).toLocaleString()} units ·{" "}
											{order.created_at ? formatDateTime(order.created_at) : "-"}
										</p>
										<p className="mt-0.5 font-mono text-[11px] text-slate-400">
											{order.batch_number || "-"}
											{order.seal_number ? ` · Seal ${order.seal_number}` : ""}
										</p>
									</div>
									<div className="flex flex-wrap gap-2">
										<button
											type="button"
											className="btn-secondary btn-sm"
											onClick={() => navigate(`/packing-list?order=${encodeURIComponent(order.id)}`)}
										>
											<FileText size={13} /> Packing list
										</button>
										<button type="button" className="btn-ghost btn-sm" onClick={() => void downloadPdf(order)}>
											<Download size={13} /> PDF
										</button>
										{closed && (
											<>
												<button type="button" className="btn-secondary btn-sm" onClick={() => void openSealModal(order)}>
													<ShieldCheck size={13} /> {order.seal_number ? "Edit seal" : "Add seal number"}
												</button>
												<button
													type="button"
													className="btn-secondary btn-sm text-amber-700"
													onClick={() => void openRecallModal(order)}
												>
													<RotateCcw size={13} /> Recall Unit
												</button>
											</>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
					<span className="text-xs font-semibold text-slate-500">
						Page {page} of {pages} · {total.toLocaleString()} orders
					</span>
					<div className="flex items-center gap-1">
						<button
							type="button"
							aria-label="Previous page"
							disabled={page <= 1}
							onClick={() => setPage((p) => p - 1)}
							className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"
						>
							<ChevronLeft size={15} />
						</button>
						{pageButtons.map((item, index) =>
							typeof item === "number" ? (
								<button
									key={`${item}-${index}`}
									type="button"
									onClick={() => setPage(item)}
									className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-bold ${item === page ? "bg-brand-600 text-white" : "border border-slate-200 text-slate-600"}`}
								>
									{item}
								</button>
							) : (
								<span key={`gap-${index}`} className="px-1 text-xs text-slate-400">{item}</span>
							),
						)}
						<button
							type="button"
							aria-label="Next page"
							disabled={page >= pages}
							onClick={() => setPage((p) => p + 1)}
							className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"
						>
							<ChevronRight size={15} />
						</button>
					</div>
				</div>
			</section>

			{sealOrder && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
					<section className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
						<div className="flex items-center justify-between border-b border-slate-100 p-5">
							<h2 className="text-base font-semibold text-slate-900">Seal number</h2>
							<button type="button" className="btn-ghost btn-sm" onClick={() => setSealOrder(null)} aria-label="Close">
								<X size={16} />
							</button>
						</div>
						<div className="space-y-3 p-5 text-sm text-slate-600">
							<p>Record or correct the physical seal tag number for order #{sealOrder.order_number || sealOrder.id}.</p>
							<input
								className="input font-mono"
								placeholder="e.g. SL-123456"
								value={sealValue}
								disabled={!sealSessionId || sealLoading}
								onChange={(event) => setSealValue(event.target.value)}
								onKeyDown={(event) => { if (event.key === "Enter") void saveSeal(); }}
							/>
						</div>
						<div className="flex justify-end gap-2 border-t border-slate-100 p-5">
							<button type="button" className="btn-secondary" onClick={() => setSealOrder(null)}>Cancel</button>
							<button
								type="button"
								className="btn-primary"
								disabled={!sealSessionId || sealLoading || sealBusy}
								onClick={() => void saveSeal()}
							>
								{sealBusy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
								{sealBusy ? "Saving…" : "Save seal number"}
							</button>
						</div>
					</section>
				</div>
			)}

			{recallOrder && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
					<section className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
						<div className="flex items-center justify-between border-b border-slate-100 p-5">
							<h2 className="text-base font-semibold text-slate-900">Recall a sealed unit</h2>
							<button type="button" className="btn-ghost btn-sm" onClick={() => setRecallOrder(null)} aria-label="Close">
								<X size={16} />
							</button>
						</div>
						<div className="space-y-3 p-5 text-sm text-slate-600">
							<p>Order #{recallOrder.order_number || recallOrder.id} · {recallOrder.seal_number || "no seal recorded"}</p>
							<input className="input font-mono" placeholder="Sealed unit QR code" value={recallQr} onChange={(event) => setRecallQr(event.target.value)} />
							<select
								className="input"
								value={recallCondition}
								onChange={(event) => setRecallCondition(event.target.value as typeof recallCondition)}
							>
								{RECALL_CONDITIONS.map((condition) => (
									<option key={condition.value} value={condition.value}>{condition.label}</option>
								))}
							</select>
							<textarea className="input" rows={2} placeholder="Reason for recall" value={recallReason} onChange={(event) => setRecallReason(event.target.value)} />
						</div>
						<div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 p-5">
							<button type="button" className="btn-secondary" onClick={() => setRecallOrder(null)}>Cancel</button>
							<button type="button" className="btn-secondary" disabled={!recallSessionId || reloading} onClick={() => void reloadOrder()}>
								{reloading ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />} Reload new product
							</button>
							<button
								type="button"
								className="btn-primary"
								disabled={!recallSessionId || recalling || !recallQr.trim() || !recallReason.trim()}
								onClick={() => void recallUnit()}
							>
								{recalling ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />} Recall Sealed Unit
							</button>
						</div>
					</section>
				</div>
			)}
		</div>
	);
}
