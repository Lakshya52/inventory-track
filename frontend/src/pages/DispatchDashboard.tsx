import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
	ArrowRight,
	Boxes,
	CheckCircle2,
	ClipboardList,
	Clock,
	FileText,
	Loader2,
	PackagePlus,
	Printer,
	QrCode,
	RefreshCw,
	ScanLine,
	Truck,
} from "lucide-react";
import { api } from "../services/api";

const WORKFLOW = [
	{
		step: 1,
		title: "Create batch",
		description: "Record the finished goods you received.",
		path: "/dispatch/batches",
		icon: PackagePlus,
		style: "bg-sky-50 text-sky-700",
	},
	{
		step: 2,
		title: "Print QR labels",
		description: "Print labels once QC passes the batch.",
		path: "/dispatch/qr-labels",
		icon: Printer,
		style: "bg-violet-50 text-violet-700",
	},
	{
		step: 3,
		title: "Create dispatch order",
		description: "Pick QC-approved stock for a customer.",
		path: "/dispatch-orders",
		icon: ClipboardList,
		style: "bg-amber-50 text-amber-700",
	},
	{
		step: 4,
		title: "Load & scan",
		description: "Scan every bag while loading the vehicle.",
		path: "/dispatch",
		icon: ScanLine,
		style: "bg-indigo-50 text-indigo-700",
	},
	{
		step: 5,
		title: "Packaging list",
		description: "Download or re-download the packing list PDF.",
		path: "/packing-list",
		icon: FileText,
		style: "bg-emerald-50 text-emerald-700",
	},
];

export default function DispatchDashboard() {
	const navigate = useNavigate();
	const [orders, setOrders] = useState<any[]>([]);
	const [batches, setBatches] = useState<any[]>([]);
	const [qrJobs, setQrJobs] = useState<any[]>([]);
	const [loadingSessions, setLoadingSessions] = useState<any[]>([]);
	const [today, setToday] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		setError("");
		try {
			const [ownOrders, allBatches, jobs, activeLoads, dispatchedToday] =
				await Promise.all([
					api.dispatchOrders.mine(),
					api.batches.list(),
					api.qc.qrJobs.list(),
					api.loadingSessions.active(),
					api.dispatch.today(),
				]);
			setOrders(
				ownOrders.filter(
					(order: any) =>
						Number(order.quantity) > 0 &&
						order.batch_id &&
						order.product_name,
				),
			);
			setBatches(allBatches);
			setQrJobs(jobs.items || []);
			setLoadingSessions(Array.isArray(activeLoads) ? activeLoads : []);
			setToday(Array.isArray(dispatchedToday) ? dispatchedToday : []);
		} catch (err: any) {
			setError(err.message || "Could not load dispatch workspace");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const openOrders = useMemo(
		() => orders.filter((order) => order.status === "APPROVED"),
		[orders],
	);
	const awaitingApproval = useMemo(
		() => orders.filter((order) => order.status === "PENDING"),
		[orders],
	);

	// One entry per created batch, so the dispatcher can see what is still with QC.
	const awaitingQc = useMemo(() => {
		const groups = new Map<string, any>();
		for (const batch of batches) {
			if (String(batch.status || "").toUpperCase() !== "PENDING_QC") continue;
			const key = String(batch.batch_group_id || batch.parent_batch_number || batch.batch_number);
			const current = groups.get(key);
			if (!current) {
				groups.set(key, {
					key,
					batch_number: batch.parent_batch_number || batch.batch_number,
					units: 0,
					products: new Set<string>(),
				});
			}
			const entry = groups.get(key);
			entry.units += 1;
			if (batch.product_name) entry.products.add(batch.product_name);
		}
		return [...groups.values()].slice(0, 6);
	}, [batches]);

	const labelsToPrint = useMemo(
		() => qrJobs.filter((job: any) => job.can_print_initial).length,
		[qrJobs],
	);

	const stats = [
		{
			label: "Orders ready to load",
			value: openOrders.length,
			icon: ClipboardList,
			style: "bg-sky-50 text-sky-700",
		},
		{
			label: "Waiting for approval",
			value: awaitingApproval.length,
			icon: Clock,
			style: "bg-amber-50 text-amber-700",
		},
		{
			label: "Labels waiting to print",
			value: labelsToPrint,
			icon: QrCode,
			style: "bg-violet-50 text-violet-700",
		},
		{
			label: "Dispatched today",
			value: today.length,
			icon: Truck,
			style: "bg-emerald-50 text-emerald-700",
		},
	];

	return (
		<div className="page-container space-y-6">
			<header className="flex flex-col gap-4 rounded-2xl border border-surface-200 bg-white px-6 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-extrabold tracking-tight text-surface-900">
						Dispatch workspace
					</h1>
					<p className="mt-1 text-sm text-surface-500">
						Everything a dispatcher needs: batches, QR labels, orders,
						loading and packing lists.
					</p>
				</div>
				<div className="flex shrink-0 flex-wrap gap-2">
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
					<Link to="/dispatch/batches" className="btn-primary btn-sm">
						<PackagePlus size={15} /> Create batch
					</Link>
				</div>
			</header>

			{error && (
				<div
					role="alert"
					className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
				>
					{error}
				</div>
			)}

			{/* Workflow shortcuts */}
			<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
				{WORKFLOW.map((item) => (
					<Link
						key={item.path}
						to={item.path}
						className="group flex flex-col gap-2 rounded-2xl border border-surface-200 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md"
					>
						<div className="flex items-center justify-between">
							<span
								className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.style}`}
							>
								<item.icon size={17} />
							</span>
							<span className="text-xs font-bold text-surface-300">
								Step {item.step}
							</span>
						</div>
						<p className="text-sm font-bold text-surface-800 group-hover:text-brand-700">
							{item.title}
						</p>
						<p className="text-xs leading-5 text-surface-500">
							{item.description}
						</p>
					</Link>
				))}
			</section>

			{/* KPI strip */}
			<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{stats.map(({ label, value, icon: Icon, style }) => (
					<div
						key={label}
						className="flex items-center gap-3 rounded-2xl border border-surface-200 bg-white p-4 shadow-sm"
					>
						<span
							className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style}`}
						>
							<Icon size={18} />
						</span>
						<div className="min-w-0">
							<p className="text-2xl font-extrabold tabular-nums text-surface-900">
								{loading ? "—" : value}
							</p>
							<p className="truncate text-xs font-medium text-surface-500">
								{label}
							</p>
						</div>
					</div>
				))}
			</section>

			<section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.85fr)]">
				<div className="card overflow-hidden">
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-100 px-5 py-4 sm:px-6">
						<div>
							<h2 className="section-title flex items-center gap-2">
								<ClipboardList
									size={18}
									className="text-brand-600"
								/>{" "}
								Orders ready to load
							</h2>
							<p className="mt-1 text-sm text-surface-500">
								Start loading from an approved dispatch order.
							</p>
						</div>
						<span className="badge badge-info">
							{openOrders.length} ready
						</span>
					</div>
					<div className="divide-y divide-surface-100">
						{openOrders.map((order) => (
							<article
								key={order.id}
								className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface-50/70 sm:flex-row sm:items-center sm:justify-between sm:px-6"
							>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-sm font-bold text-surface-900">
											{order.client_name || `Order #${order.id}`}
										</span>
										<span className="badge badge-neutral">
											Order #{order.id}
										</span>
									</div>
									<p className="mt-1 text-xs text-surface-500">
										{order.items?.length > 1
											? `${order.items.length} product lines`
											: order.product_name}{" "}
										· {Number(order.quantity).toLocaleString()} units
										{order.storage_location
											? ` · ${order.storage_location}`
											: ""}
									</p>
								</div>
								<button
									className="btn-primary btn-sm shrink-0"
									onClick={() =>
										navigate(
											`/dispatch?order=${encodeURIComponent(order.id)}`,
										)
									}
								>
									Load order <ArrowRight size={14} />
								</button>
							</article>
						))}
						{!loading && openOrders.length === 0 && (
							<div className="px-6 py-12 text-center">
								<span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
									<CheckCircle2 size={22} />
								</span>
								<p className="mt-3 text-sm font-semibold text-surface-800">
									No orders are waiting to load
								</p>
								<p className="mt-1 text-xs text-surface-500">
									Approved dispatch orders will appear here.
								</p>
							</div>
						)}
						{loading && (
							<div className="px-6 py-10 text-center text-sm text-surface-400">
								<Loader2
									size={16}
									className="mr-2 inline animate-spin"
								/>
								Loading dispatch orders…
							</div>
						)}
					</div>
					<div className="border-t border-surface-100 px-5 py-3 sm:px-6">
						<Link
							to="/dispatch-orders"
							className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
						>
							View all dispatch orders <ArrowRight size={13} />
						</Link>
					</div>
				</div>

				<div className="space-y-5">
					<div className="card overflow-hidden">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-100 px-5 py-4">
							<div>
								<h2 className="section-title flex items-center gap-2">
									<Clock size={18} className="text-amber-600" /> Orders
									waiting for approval
								</h2>
								<p className="mt-1 text-sm text-surface-500">
									These are sent to QC. Load them once approved.
								</p>
							</div>
							<span className="badge badge-warning">
								{awaitingApproval.length} pending
							</span>
						</div>
						<div className="divide-y divide-surface-100">
							{awaitingApproval.map((order) => (
								<div
									key={order.id}
									className="flex items-center justify-between gap-3 px-5 py-3"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold text-surface-800">
											{order.client_name || `Order #${order.id}`}
										</p>
										<p className="mt-0.5 text-xs text-surface-500">
											{Number(order.quantity || 0).toLocaleString()} units ·{" "}
											{order.items?.length > 1
												? `${order.items.length} product lines`
												: order.product_name || "—"}
										</p>
									</div>
									<span className="shrink-0 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800">
										Pending
									</span>
								</div>
							))}
							{!loading && awaitingApproval.length === 0 && (
								<div className="px-5 py-8 text-center text-xs text-surface-400">
									No orders are waiting for approval.
								</div>
							)}
						</div>
					</div>

					<div className="card overflow-hidden">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-100 px-5 py-4">
							<div>
								<h2 className="section-title flex items-center gap-2">
									<Clock size={18} className="text-amber-600" /> Awaiting
									QC
								</h2>
								<p className="mt-1 text-sm text-surface-500">
									Batches you created that QC still has to review.
								</p>
							</div>
						</div>
						<div className="divide-y divide-surface-100">
							{awaitingQc.map((group) => (
								<div
									key={group.key}
									className="flex items-center justify-between gap-3 px-5 py-3"
								>
									<div className="min-w-0">
										<p className="truncate font-mono text-xs font-semibold text-surface-700">
											{group.batch_number}
										</p>
										<p className="mt-0.5 truncate text-xs text-surface-500">
											{[...group.products].join(", ") || "—"}
										</p>
									</div>
									<span className="shrink-0 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold tabular-nums text-amber-800">
										{group.units} units
									</span>
								</div>
							))}
							{!loading && awaitingQc.length === 0 && (
								<div className="px-5 py-8 text-center text-xs text-surface-400">
									No batches are waiting for QC.
								</div>
							)}
						</div>
						<div className="border-t border-surface-100 p-4">
							<Link
								to="/dispatch/batches"
								className="btn-secondary flex w-full justify-center"
							>
								<PackagePlus size={14} /> Create another batch
							</Link>
						</div>
					</div>

					<div className="card overflow-hidden">
						<div className="border-b border-surface-100 px-5 py-4">
							<h2 className="section-title flex items-center gap-2">
								<Boxes size={18} className="text-sky-600" /> Quick links
							</h2>
						</div>
						<div className="divide-y divide-surface-100">
							{[
								{
									label: "Print or re-print QR labels",
									description:
										"Print the labels of QC-approved batches, or raise a re-print request.",
									path: "/dispatch/qr-labels",
									icon: QrCode,
								},
								{
									label: "Packaging lists",
									description:
										"Open, print or re-download the packing list PDF of any order.",
									path: "/packing-list",
									icon: FileText,
								},
								{
									label: "Loading & scan",
									description:
										"Resume an active loading session or start a new one.",
									path: "/dispatch",
									icon: ScanLine,
								},
							].map((link) => (
								<Link
									key={link.path}
									to={link.path}
									className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-surface-50"
								>
									<span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-600">
										<link.icon size={15} />
									</span>
									<span className="min-w-0 flex-1">
										<span className="block text-sm font-semibold text-surface-800">
											{link.label}
										</span>
										<span className="mt-0.5 block text-xs leading-5 text-surface-500">
											{link.description}
										</span>
									</span>
									<ArrowRight
										size={14}
										className="mt-1 shrink-0 text-surface-300"
									/>
								</Link>
							))}
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
