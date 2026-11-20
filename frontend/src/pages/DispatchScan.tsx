import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BrowserMultiFormatReader } from "@zxing/library";
import { api } from "../services/api";
import { orderNumber } from "../utils/orderNumber";
import {
	RECALL_CONDITIONS,
	recallConditionHint,
	recallConditionLabel,
} from "../utils/recallConditions";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { formatDateTime as formatIsoDateTime } from "../utils/dateFormat";
import {
	AlertTriangle,
	ArrowUpDown,
	Boxes,
	Camera,
	CheckCircle,
	ChevronDown,
	ClipboardList,
	Clock,
	Loader2,
	Play,
	RotateCcw,
	PackageCheck,
	QrCode,
	RefreshCw,
	ScanLine,
	Search,
	ShieldCheck,
	Truck,
	X,
	XCircle,
} from "lucide-react";

const reader = new BrowserMultiFormatReader();
// A dedicated reader for the recall-product scanner, kept separate so it never
// fights the main loading-scan camera for the same hardware.
const recallReader = new BrowserMultiFormatReader();

type ScanResult = "OK" | "DUPLICATE" | "WRONG_BATCH" | "QTY_EXCEEDED" | "RECALLED";
type InlineResult = ScanResult | "ERROR";
type MessageKind = "success" | "error" | "warning" | "info";
type Outcome = "DISPATCHED" | "NOT_DISPATCHED";

interface LoadingSession {
	id: string;
	status: string;
	total: number;
	scanned: number;
	dispatch_order_id: string;
	order_number: string | null;
	batch_id: string;
	batch_number: string | null;
	product_name: string | null;
	grade_name?: string | null;
	client_name: string | null;
	driver_name: string | null;
	vehicle_number: string | null;
	container_number: string | null;
	qr_values?: string[];
	order_lines?: Array<{
		batch_id: string;
		batch_number: string;
		product_name: string;
		product_sku?: string;
		quantity: number;
		uom?: string;
		qr_values?: string[];
	}>;
	uom: string | null;
	started_at: string | null;
}

interface RecentScan {
	key: string;
	qr: string;
	result: ScanResult;
	at: string | null;
}

interface InlineScan {
	qr: string;
	result: InlineResult;
	at: number;
}

const MESSAGE_STYLES: Record<MessageKind, string> = {
	success: "bg-emerald-50 text-emerald-700 border-emerald-200",
	error: "bg-rose-50 text-rose-700 border-rose-200",
	warning: "bg-amber-50 text-amber-700 border-amber-200",
	info: "bg-sky-50 text-sky-700 border-sky-200",
};

// Order-list windowing: mount a first screen, then grow it on demand so a
// work-list with hundreds of dispatch orders stays responsive.
const PAGE_SIZE = 50;
const PAGE_STEP = 100;

const RESULT_LABELS: Record<ScanResult, string> = {
	OK: "OK",
	DUPLICATE: "Duplicate",
	WRONG_BATCH: "Wrong batch",
	QTY_EXCEEDED: "Qty exceeded",
	RECALLED: "Recalled",
};

const INLINE_STYLES: Record<InlineResult, { wrap: string; label: string }> = {
	OK: {
		wrap: "border-emerald-200 bg-emerald-50 text-emerald-800",
		label: "Unit accepted",
	},
	DUPLICATE: {
		wrap: "border-amber-200 bg-amber-50 text-amber-800",
		label: "Already scanned",
	},
	WRONG_BATCH: {
		wrap: "border-rose-200 bg-rose-50 text-rose-800",
		label: "Belongs to another batch",
	},
	QTY_EXCEEDED: {
		wrap: "border-rose-200 bg-rose-50 text-rose-800",
		label: "Quantity exceeded",
	},
	RECALLED: {
		wrap: "border-amber-200 bg-amber-50 text-amber-800",
		label: "Recalled",
	},
	ERROR: {
		wrap: "border-rose-200 bg-rose-50 text-rose-800",
		label: "Scan failed",
	},
};

function operationId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		try {
			return crypto.randomUUID();
		} catch {
			// Fall through to the timestamp-based id below.
		}
	}
	return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resultBadge(result: string): string {
	if (result === "OK") return "badge-success";
	if (result === "DUPLICATE" || result === "RECALLED") return "badge-warning";
	return "badge-danger";
}

function text(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const valueText = String(value).trim();
	return valueText || null;
}

/** Grade name is the headline everywhere on this page; old rows may only
 * carry a product name, so fall back to it rather than showing nothing. */
function gradeLabel(source: any): string {
	return text(source?.grade_name) ?? text(source?.product_name) ?? "-";
}

function formatTime(value?: string | number | null): string {
	if (value === null || value === undefined || value === "") return "-";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString();
}

function formatDateTime(value?: string | null): string {
	return formatIsoDateTime(value, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function timeValue(value?: string | null): number {
	if (!value) return 0;
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? 0 : time;
}

function normalizeScanResult(value: unknown): ScanResult {
	const result = String(value ?? "").toUpperCase();
	if (
		result === "DUPLICATE" ||
		result === "WRONG_BATCH" ||
		result === "QTY_EXCEEDED" ||
		result === "RECALLED"
	)
		return result;
	return "OK";
}

function normalizeSession(raw: any, fallback?: any): LoadingSession {
	const source = raw?.session ?? raw ?? {};
	const base = fallback ?? {};
	return {
		id: String(source?.id ?? source?.session_id ?? ""),
		status: String(source?.status ?? "ACTIVE"),
		total: Math.max(
			0,
			Number(source?.total ?? base?.quantity ?? base?.total ?? 0),
		),
		scanned: Math.max(0, Number(source?.scanned ?? 0)),
		dispatch_order_id: String(
			source?.dispatch_order_id ?? source?.order_id ?? base?.id ?? "",
		),
		order_number: text(source?.order_number) ?? text(base?.order_number) ?? null,
		batch_id: String(source?.batch_id ?? base?.batch_id ?? ""),
		batch_number: text(source?.batch_number) ?? text(base?.batch_number),
		order_lines: source?.order_lines ?? base?.items ?? [],
		qr_values: ((): string[] => {
			const candidate = source?.qr_values ?? base?.qr_values;
			if (Array.isArray(candidate)) return candidate.map(String).filter(Boolean);
			if (Array.isArray(source?.items)) {
				return source.items.flatMap((item: any) =>
					Array.isArray(item?.qr_values) ? item.qr_values.map(String) : [],
				);
			}
				return [];
		})(),
		product_name: text(source?.product_name) ?? text(base?.product_name),
		grade_name: text(source?.grade_name) ?? text(base?.grade_name),
		client_name: text(source?.client_name) ?? text(base?.client_name),
		driver_name: text(source?.driver_name) ?? text(base?.driver_name),
		vehicle_number:
			text(source?.vehicle_number) ?? text(base?.vehicle_number),
		container_number:
			text(source?.container_number) ?? text(base?.container_number),
		uom: text(source?.uom) ?? text(base?.uom),
		started_at: text(source?.started_at) ?? text(base?.started_at),
	};
}

function normalizeEvent(event: any, index: number): RecentScan {
	const at = event?.scanned_at ?? event?.created_at ?? null;
	return {
		key: String(
			event?.event_id ?? event?.id ?? `${at ?? "event"}-${index}`,
		),
		qr: String(event?.qr_value ?? event?.qr ?? ""),
		result: normalizeScanResult(event?.result),
		at: at ? String(at) : null,
	};
}

function mapRecentEvents(events: any[]): RecentScan[] {
	return events
		.map(normalizeEvent)
		.filter((event) => event.qr)
		.sort((a, b) => timeValue(b.at) - timeValue(a.at))
		.slice(0, 12);
}

function percent(scanned: number, total: number): number {
	if (total <= 0) return 0;
	return Math.min(100, Math.max(0, Math.round((scanned / total) * 100)));
}

function DetailRow({
	label,
	value,
	mono = false,
}: {
	label: string;
	value?: string | null;
	mono?: boolean;
}) {
	return (
		<div className="flex items-start justify-between gap-3 border-b border-surface-100 py-2 last:border-0">
			<dt className="shrink-0 font-medium text-surface-500">{label}</dt>
			<dd
				className={`min-w-0 truncate text-right font-semibold text-surface-800 ${mono ? "font-mono" : ""}`}
				title={value || undefined}
			>
				{value || "-"}
			</dd>
		</div>
	);
}

export default function DispatchScan() {
	const [orders, setOrders] = useState<any[]>([]);
	const [ordersLoading, setOrdersLoading] = useState(true);
	const [orderSearch, setOrderSearch] = useState("");
	const debouncedOrderSearch = useDebouncedValue(orderSearch, 250);
	// Incremental rendering: the work-list can hold hundreds of orders, so only
	// a window is mounted until the operator asks for more.
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const [sortAsc, setSortAsc] = useState(false);
	const [startingOrderId, setStartingOrderId] = useState<string | null>(null);
	const [selectedOrderId, setSelectedOrderId] = useState("");
	const [session, setSession] = useState<LoadingSession | null>(null);
	const [activeSession, setActiveSession] = useState<LoadingSession | null>(
		null,
	);
	const [checkingActive, setCheckingActive] = useState(true);
	const [starting, setStarting] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [scanBusy, setScanBusy] = useState(false);
	const [manualValue, setManualValue] = useState("");
	const [message, setMessage] = useState("");
	const [messageKind, setMessageKind] = useState<MessageKind>("info");
	const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
	const [lastScan, setLastScan] = useState<InlineScan | null>(null);
	const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
	const [pollError, setPollError] = useState(false);
	const [cancelOpen, setCancelOpen] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const [sealNumber, setSealNumber] = useState("");
	const [recallQr, setRecallQr] = useState("");
	const [recallReason, setRecallReason] = useState("");
	const [recallCondition, setRecallCondition] = useState<
		"DAMAGED" | "HOLD" | "RETURN_TO_STOCK"
	>("DAMAGED");
	const [recalling, setRecalling] = useState(false);
	const [recallScanning, setRecallScanning] = useState(false);
	// Recall is an exception flow — the panel stays tucked away until asked for.
	const [recallOpen, setRecallOpen] = useState(false);
	const recallVideoRef = useRef<HTMLVideoElement>(null);
	const [driverName, setDriverName] = useState("");
	const [driverPhone, setDriverPhone] = useState("");
	const [vehicleNumber, setVehicleNumber] = useState("");
	const [containerNumber, setContainerNumber] = useState("");
	const [outcome, setOutcome] = useState<Outcome>("DISPATCHED");
	const [remarks, setRemarks] = useState("");
	const [finalising, setFinalising] = useState(false);
	const [finaliseResult, setFinaliseResult] = useState<any>(null);
	// Seal tag numbers are often known only after the truck is physically sealed.
	const [sealEditOpen, setSealEditOpen] = useState(false);
	const [sealEditValue, setSealEditValue] = useState("");
	const [savingSeal, setSavingSeal] = useState(false);
	const [sealedRecallQr, setSealedRecallQr] = useState("");
	const [sealedRecallReason, setSealedRecallReason] = useState("");
	const [sealedRecallCondition, setSealedRecallCondition] = useState<
		"DAMAGED" | "HOLD" | "RETURN_TO_STOCK"
	>("DAMAGED");
	const [sealedRecalling, setSealedRecalling] = useState(false);
	const [reloadPending, setReloadPending] = useState(0);
	const [reloading, setReloading] = useState(false);
	const [todayDispatches, setTodayDispatches] = useState<any[]>([]);
	const [searchParams, setSearchParams] = useSearchParams();

	const sessionIdRef = useRef<string | null>(null);
	const scanInFlightRef = useRef(false);
	const lastScanRef = useRef<{ qr: string; at: number }>({ qr: "", at: 0 });
	const scanHandlerRef = useRef<(qr: string) => void>(() => {});
	const deepLinkHandledRef = useRef(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	const manualScanRef = useRef<HTMLInputElement>(null);
	const orderSearchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		sessionIdRef.current = session?.id ?? null;
	}, [session?.id]);

	useEffect(() => {
		if (session?.id && window.matchMedia("(pointer: fine)").matches) {
			manualScanRef.current?.focus({ preventScroll: true });
		}
	}, [session?.id]);

	const allScanned = Boolean(
		session && session.total > 0 && session.scanned >= session.total,
	);

	const stopCamera = useCallback(() => {
		try {
			reader.reset();
		} catch {
			// The decoder may already be reset.
		}
	}, []);

	useEffect(() => () => stopCamera(), [stopCamera]);

	const loadOrders = useCallback(async () => {
		setOrdersLoading(true);
		try {
			const list = await api.dispatchOrders.mine({ status: "APPROVED" });
			const readyOrders = Array.isArray(list)
				? list.filter(
						(order: any) =>
							order.status === "APPROVED" &&
							Number(order.quantity) > 0 &&
							Boolean(order.batch_id) &&
							Number(order.qr_count ?? order.quantity) >=
								Number(order.quantity),
					)
				: [];
			setOrders(readyOrders);
		} catch (err: any) {
			setMessageKind("error");
			setMessage(
				err?.message || "Could not load dispatch orders. Please retry.",
			);
		} finally {
			setOrdersLoading(false);
		}
	}, []);

	const loadToday = useCallback(async () => {
		try {
			setTodayDispatches(await api.dispatch.today());
		} catch {
			// Keep the last known list when the network is unavailable.
		}
	}, []);

	const loadActiveSession = useCallback(async () => {
		setCheckingActive(true);
		try {
			const list = await api.loadingSessions.active();
			const rows = Array.isArray(list) ? list : [];
			if (rows.length > 0) {
				setActiveSession(normalizeSession(rows[0]));
			} else {
				setActiveSession(null);
			}
		} catch {
			// The resume banner is best-effort; the scan flow still works without it.
		} finally {
			setCheckingActive(false);
		}
	}, []);

	useEffect(() => {
		void loadOrders();
		void loadToday();
		void loadActiveSession();
	}, [loadOrders, loadToday, loadActiveSession]);

	const selectedOrder = useMemo(
		() =>
			orders.find((order) => String(order.id) === selectedOrderId) ||
			null,
		[orders, selectedOrderId],
	);

	const filteredOrders = useMemo(() => {
		const needle = debouncedOrderSearch.trim().toLowerCase();
		const matched = !needle
			? orders
			: orders.filter((order) =>
					[
						order.order_number,
						order.id,
						order.batch_number,
						order.grade_name,
						order.product_name,
						order.product_sku,
						order.client_name,
						order.driver_name,
						order.vehicle_number,
						order.container_number,
						...(Array.isArray(order.qr_values)
							? order.qr_values
							: []),
						...(Array.isArray(order.items)
							? order.items.flatMap((item: any) => [
									...(Array.isArray(item?.qr_values)
										? item.qr_values
										: []),
									item?.batch_number,
									item?.product_name,
								])
							: []),
					]
						.filter(Boolean)
						.some((value) =>
							String(value).toLowerCase().includes(needle),
						),
				);
		// The server returns newest first; the toggle shows the oldest first.
		return sortAsc ? [...matched].reverse() : matched;
	}, [orders, debouncedOrderSearch, sortAsc]);

	const visibleOrders = useMemo(
		() => filteredOrders.slice(0, visibleCount),
		[filteredOrders, visibleCount],
	);

	// Total units in the current result set — the operator's "how much is
	// waiting" number.
	const filteredUnits = useMemo(
		() =>
			filteredOrders.reduce(
				(sum, order) => sum + (Number(order.quantity) || 0),
				0,
			),
		[filteredOrders],
	);

	// A new search or sort direction starts the window over.
	useEffect(() => {
		setVisibleCount(PAGE_SIZE);
	}, [debouncedOrderSearch, sortAsc]);

	// Enrich the resume banner with client/driver details once the order list arrives.
	useEffect(() => {
		if (!activeSession) return;
		const order = orders.find(
			(item) => String(item.id) === activeSession.dispatch_order_id,
		);
		if (!order) return;
		const enriched = normalizeSession(activeSession, order);
		if (JSON.stringify(enriched) !== JSON.stringify(activeSession)) {
			setActiveSession(enriched);
		}
	}, [orders, activeSession]);

	// Deep link support: /dispatch?order=<id>
	useEffect(() => {
		if (ordersLoading || deepLinkHandledRef.current) return;
		const requested = searchParams.get("order");
		if (!requested) return;
		deepLinkHandledRef.current = true;
		if (orders.some((order) => String(order.id) === requested)) {
			setSelectedOrderId(requested);
		} else {
			setMessageKind("info");
			setMessage(
				`Order #${requested} is not in your open dispatches. Choose another order below.`,
			);
		}
		const next = new URLSearchParams(searchParams);
		next.delete("order");
		setSearchParams(next, { replace: true });
	}, [orders, ordersLoading, searchParams, setSearchParams]);

	// Keyboard shortcuts for the work-list: "/" focuses the search from
	// anywhere (unless already typing), Escape clears a focused search.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const typing =
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.tagName === "SELECT" ||
					target.isContentEditable);
			if (
				event.key === "Escape" &&
				document.activeElement === orderSearchRef.current
			) {
				setOrderSearch("");
				return;
			}
			if (event.key !== "/" || session || typing) return;
			event.preventDefault();
			orderSearchRef.current?.focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [session]);

	const selectOrder = (id: string) => {
		if (session) return;
		setSelectedOrderId(id);
		setMessage("");
		setLastScan(null);
		setScanning(false);
		stopCamera();
	};

	const resetToOrders = useCallback(() => {
		setSession(null);
		setSelectedOrderId("");
		setRecentScans([]);
		setLastScan(null);
		setLastSyncedAt(null);
		setPollError(false);
		setSealNumber("");
		setDriverName("");
		setDriverPhone("");
		setVehicleNumber("");
		setContainerNumber("");
		setRemarks("");
		setOutcome("DISPATCHED");
		setScanning(false);
		stopCamera();
	}, [stopCamera]);

	const resumeSession = async (target: LoadingSession) => {
		const order =
			orders.find(
				(item) => String(item.id) === target.dispatch_order_id,
			) || null;
		let next = normalizeSession(target, order);
		let events: any[] = [];
		try {
			const data = await api.loadingSessions.get(target.id);
			const raw = data?.session ?? data;
			if (raw) next = normalizeSession(raw, target);
			events = Array.isArray(data?.events) ? data.events : [];
		} catch {
			// The 2-second poll will hydrate the counters shortly.
		}

		if (next.status !== "ACTIVE") {
			setActiveSession(null);
			setMessageKind("warning");
			setMessage(
				"That loading session is no longer active. Choose an open dispatch order to start again.",
			);
			await Promise.all([loadOrders(), loadActiveSession()]);
			return;
		}

		setSession(next);
		setActiveSession(null);
		setSelectedOrderId(next.dispatch_order_id);
		setRecentScans(mapRecentEvents(events));
		setLastScan(null);
		setLastSyncedAt(Date.now());
		setPollError(false);
		setSealNumber("");
		setDriverName(next.driver_name || "");
		setDriverPhone(order?.driver_phone || "");
		setVehicleNumber(next.vehicle_number || "");
		setContainerNumber(next.container_number || "");
		setRemarks("");
		setOutcome("DISPATCHED");
		setScanning(false);
		setMessageKind("info");
		setMessage(
			`Resumed loading session for order #${orderNumber(next)} — ${next.scanned}/${next.total} units already scanned.`,
		);
	};

	// Starts a session for an explicit order (per-row "Start Loading") or,
	// with no argument, for the currently selected order.
	const startSession = async (order: any = selectedOrder) => {
		if (!order) {
			setMessageKind("error");
			setMessage(
				"Select a dispatch order before starting a loading session.",
			);
			return;
		}
		if (starting) return;
		setStarting(true);
		setStartingOrderId(String(order.id));
		setMessage("");
		setFinaliseResult(null);
		setLastScan(null);
		setScanning(false);
		stopCamera();
		try {
			const response = await api.loadingSessions.start(
				order.id,
				operationId(),
			);
			const payload = response?.session ?? response;
			const next = normalizeSession(
				{
					...payload,
					batch_number:
						response?.batch_number ?? payload?.batch_number,
					product_name:
						response?.product_name ?? payload?.product_name,
					grade_name: response?.grade_name ?? payload?.grade_name,
				},
				order,
			);
			if (!next.id)
				throw new Error(
					"The server did not return a loading session id.",
				);
			setSession(next);
			setActiveSession(null);
			setRecentScans([]);
			setLastSyncedAt(Date.now());
			setPollError(false);
			setSealNumber("");
			setDriverName(order.driver_name || "");
			setDriverPhone(order.driver_phone || "");
			setVehicleNumber(order.vehicle_number || "");
			setContainerNumber(order.container_number || "");
			setRemarks("");
			setOutcome("DISPATCHED");
			setMessageKind("success");
			setMessage(
				`Loading session started for order #${orderNumber(order)} — scan ${next.total} units.`,
			);
		} catch (err: any) {
			// If the order already has an active session, resume it instead of failing.
			try {
				const active = await api.loadingSessions.active();
				const match = (Array.isArray(active) ? active : []).find(
					(item: any) =>
						String(item.order_id ?? item.dispatch_order_id) ===
						String(order.id),
				);
				if (match) {
					await resumeSession(normalizeSession(match, order));
					return;
				}
			} catch {
				// Fall through to the original error message.
			}
			setMessageKind("error");
			setMessage(err?.message || "Could not start the loading session.");
		} finally {
			setStarting(false);
			setStartingOrderId(null);
		}
	};

	const doScan = useCallback(async (rawValue: string) => {
		const qrValue = rawValue.trim();
		const currentSessionId = sessionIdRef.current;
		if (!qrValue || !currentSessionId || scanInFlightRef.current) return;

		const now = Date.now();
		if (
			lastScanRef.current.qr === qrValue &&
			now - lastScanRef.current.at < 2000
		)
			return;
		lastScanRef.current = { qr: qrValue, at: now };

		scanInFlightRef.current = true;
		setScanBusy(true);
		try {
			const response = await api.loadingSessions.scan(
				currentSessionId,
				qrValue,
				operationId(),
			);
			const result = normalizeScanResult(response?.result);
			const scanned = Number(response?.scanned ?? 0);
			const total = Number(response?.total ?? 0);

			setSession((prev) => {
				if (!prev || prev.id !== currentSessionId) return prev;
				return {
					...prev,
					scanned: Number(response?.scanned ?? prev.scanned),
					total: Number(response?.total ?? prev.total),
				};
			});
			setRecentScans((prev) =>
				[
					{
						key: String(
							response?.event_id ?? `${Date.now()}-${qrValue}`,
						),
						qr: qrValue,
						result,
						at: new Date().toISOString(),
					},
					...prev,
				].slice(0, 12),
			);
			setLastScan({ qr: qrValue, result, at: Date.now() });
			setLastSyncedAt(Date.now());
			setPollError(false);
			if (result === "OK") {
				setMessageKind("success");
				setMessage("");
			} else if (result === "DUPLICATE") {
				setMessageKind("warning");
				setMessage("That QR was already loaded in this session.");
			} else if (result === "RECALLED") {
				setMessageKind("warning");
				setMessage("That QR was recalled and cannot be loaded.");
			} else if (result === "WRONG_BATCH") {
				setMessageKind("error");
				setMessage(
					"That QR belongs to a different batch or order — scan a unit from this batch only.",
				);
			} else if (result === "QTY_EXCEEDED") {
				setMessageKind("error");
				setMessage(
					"The load target is already reached. Recall a unit or seal the container.",
				);
			} else {
				setMessageKind("error");
				setMessage("Scan rejected.");
			}
			setManualValue("");
		} catch (err: any) {
			setLastScan({ qr: qrValue, result: "ERROR", at: Date.now() });
			setMessageKind("error");
			setMessage(
				err?.message ||
					"Scan failed. Check the connection and try again.",
			);
		} finally {
			scanInFlightRef.current = false;
			setScanBusy(false);
		}
	}, []);

	useEffect(() => {
		scanHandlerRef.current = (qr: string) => {
			void doScan(qr);
		};
	}, [doScan]);

	const submitManual = () => {
		const value = manualValue.trim();
		if (
			!value ||
			!session ||
			session.status !== "ACTIVE" ||
			scanInFlightRef.current
		)
			return;
		setManualValue("");
		void doScan(value);
	};

	const submitRecall = async () => {
		if (!session || !recallQr.trim() || !recallReason.trim() || recalling)
			return;
		setRecalling(true);
		setMessage("");
		try {
			const result = await api.loadingSessions.recallQr(session.id, {
				qr_value: recallQr.trim(),
				condition: recallCondition,
				reason: recallReason.trim(),
			});
			setSession((current) =>
				current && current.id === session.id
					? {
							...current,
							total: Number(
								result?.total ?? Math.max(0, current.total - 1),
							),
							scanned: Number(result?.scanned ?? current.scanned),
						}
					: current,
			);
			setRecallQr("");
			setRecallReason("");
			setMessageKind("success");
			setMessage(
				Number(result?.recalled_units ?? 0) > 0
					? Number(result?.unfilled_units ?? 0) > 0
						? `Loaded QR recalled (${recallConditionLabel(recallCondition)}). No spare printed label was available — the order and load target were reduced.`
						: `Loaded QR recalled (${recallConditionLabel(recallCondition)}). The unit was removed from the load — scan the replacement unit before sealing.`
					: `QR recalled (${recallConditionLabel(recallCondition)}) and excluded from this loading order.`,
			);
			setLastSyncedAt(Date.now());
		} catch (err: any) {
			setMessageKind("error");
			setMessage(err?.message || "Could not recall this QR label.");
		} finally {
			setRecalling(false);
			setRecallScanning(false);
			stopRecallCamera();
		}
	};

	// Post-seal recall: the container is already sealed. A recalled unit is
	// removed from the sealed load and queued for a replacement reload against
	// the same dispatch order.
	const submitSealedRecall = async () => {
		const sealedSessionId = finaliseResult?.session?.id;
		if (!sealedSessionId) {
			setMessageKind("error");
			setMessage(
				"No finalised session found here. Open the order from Dispatch Orders and use Recall Unit instead.",
			);
			return;
		}
		if (!sealedRecallQr.trim() || !sealedRecallReason.trim() || sealedRecalling)
			return;
		setSealedRecalling(true);
		setMessage("");
		try {
			const result = await api.loadingSessions.recallSealed(sealedSessionId, {
				qr_value: sealedRecallQr.trim(),
				condition: sealedRecallCondition,
				reason: sealedRecallReason.trim(),
			});
			setReloadPending(Number(result?.reload_pending ?? 0));
			setSealedRecallQr("");
			setSealedRecallReason("");
			setMessageKind("success");
			setMessage(
				`Sealed unit recalled (${recallConditionLabel(sealedRecallCondition)}). ${Number(result?.reload_pending ?? 1)} replacement unit(s) pending — use "Reload new product" to reopen this order.`,
			);
		} catch (err: any) {
			setMessageKind("error");
			setMessage(err?.message || "Could not recall the sealed unit.");
		} finally {
			setSealedRecalling(false);
		}
	};

	// Reload replacement product against the same dispatch order the sealed
	// container belonged to. The order reopens as APPROVED so a fresh loading
	// session (scan -> seal) can be started for just the recalled units.
	const reloadReplacementOrder = async () => {
		const sealedSessionId = finaliseResult?.session?.id;
		if (!sealedSessionId) {
			setMessageKind("error");
			setMessage(
				"No finalised session found here. Open the order from Dispatch Orders and use Recall Unit instead.",
			);
			return;
		}
		if (reloading) return;
		setReloading(true);
		setMessage("");
		try {
			const result = await api.loadingSessions.reload(sealedSessionId);
			setReloadPending(0);
			setFinaliseResult(null);
			setMessageKind(Number(result?.unfilled_units ?? 0) > 0 ? "warning" : "success");
			setMessage(
				`Order ${result?.order_number ?? result?.order_id} reopened for ${Number(result?.quantity ?? 0)} replacement unit(s). Start a loading session to load the new product.${Number(result?.unfilled_units ?? 0) > 0 ? ` Warning: ${result?.unfilled_units} unit(s) have no spare printed label — print more labels for the batch before loading.` : ""}`,
			);
			void loadOrders();
		} catch (err: any) {
			setMessageKind("error");
			setMessage(err?.message || "Could not reload this order.");
		} finally {
			setReloading(false);
		}
	};

	// Keep the active session in sync (including scans made from another device).
	useEffect(() => {
		const sessionId = session?.id;
		if (!sessionId || session?.status !== "ACTIVE") return;
		let cancelled = false;

		const tick = async () => {
			if (scanInFlightRef.current) return;
			try {
				const data = await api.loadingSessions.get(sessionId);
				if (cancelled || scanInFlightRef.current) return;
				const raw = data?.session ?? data;
				const status = String(raw?.status ?? "ACTIVE");

				setSession((prev) => {
					if (!prev || prev.id !== sessionId) return prev;
					const merged = normalizeSession(raw, prev);
					return {
						...prev,
						status,
						scanned: Math.max(
							0,
							Number(raw?.scanned ?? prev.scanned),
						),
						total: Math.max(0, Number(raw?.total ?? prev.total)),
						batch_number: merged.batch_number ?? prev.batch_number,
						product_name: merged.product_name ?? prev.product_name,
						grade_name: merged.grade_name ?? prev.grade_name,
						started_at: merged.started_at ?? prev.started_at,
					};
				});
				setPollError(false);
				setLastSyncedAt(Date.now());

				const events: any[] = Array.isArray(data?.events)
					? data.events
					: [];
				if (events.length > 0) {
					setRecentScans(mapRecentEvents(events));
				}

				if (status !== "ACTIVE") {
					setScanning(false);
					stopCamera();
					setActiveSession(null);
					setSession(null);
					setSelectedOrderId("");
					setMessageKind(status === "CANCELLED" ? "warning" : "info");
					setMessage(
						status === "CANCELLED"
							? "This loading session was cancelled. Choose an open dispatch order to start again."
							: "This loading session was closed on another device.",
					);
					void Promise.all([loadOrders(), loadToday()]);
				}
			} catch {
				// Keep the last known counter; the next poll retries.
				if (!cancelled) setPollError(true);
			}
		};

		const interval = window.setInterval(() => {
			void tick();
		}, 2000);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [session?.id, session?.status, loadOrders, loadToday, stopCamera]);

	// Camera scanning. The handler reads live state through a ref so the camera
	// is not restarted on every counter update.
	useEffect(() => {
		if (!scanning) return;
		if (!session || session.status !== "ACTIVE") {
			setScanning(false);
			return;
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			setMessageKind("error");
			setMessage(
				"Camera is not supported here. Use HTTPS or localhost, or enter the QR code manually.",
			);
			setScanning(false);
			return;
		}
		const video = videoRef.current;
		if (!video) return;
		let cancelled = false;

		(async () => {
			try {
				await reader.decodeFromVideoDevice(null, video, (result) => {
					if (cancelled || !result) return;
					const value = result.getText().trim();
					if (value) scanHandlerRef.current(value);
				});
			} catch (err: any) {
				if (cancelled) return;
				setMessageKind("error");
				setMessage(
					err?.message?.includes?.("Permission")
						? "Camera permission denied. Allow camera access or enter the QR code manually."
						: "Camera could not start. Enter the QR code manually or try again.",
				);
				setScanning(false);
				stopCamera();
			}
		})();

		return () => {
			cancelled = true;
			stopCamera();
		};
	}, [scanning, session?.id, session?.status, stopCamera]);

	// Once every unit is counted, stop the camera so stray scans do not fire errors.
	useEffect(() => {
		if (
			scanning &&
			session &&
			session.total > 0 &&
			session.scanned >= session.total
		) {
			stopCamera();
			setScanning(false);
		}
	}, [scanning, session?.total, session?.scanned, stopCamera]);

	const stopRecallCamera = useCallback(() => {
		try {
			recallReader.reset();
		} catch {
			// The decoder may already be reset.
		}
	}, []);
	// Release the recall camera when leaving the page.
	useEffect(() => () => stopRecallCamera(), [stopRecallCamera]);

	// Recall-product camera: decodes straight into the recall QR field. The
	// text field stays usable — this is purely an alternative way to fill it.
	useEffect(() => {
		if (!recallScanning) return;
		if (!session || session.status !== "ACTIVE") {
			setRecallScanning(false);
			return;
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			setMessageKind("error");
			setMessage(
				"Camera is not supported here. Use HTTPS or localhost, or enter the QR code manually.",
			);
			setRecallScanning(false);
			return;
		}
		const video = recallVideoRef.current;
		if (!video) return;
		let cancelled = false;

		(async () => {
			try {
				await recallReader.decodeFromVideoDevice(null, video, (result) => {
					if (cancelled || !result) return;
					const value = result.getText().trim();
					if (value) {
						setRecallQr(value);
						setRecallScanning(false);
					}
				});
			} catch (err: any) {
				if (cancelled) return;
				setMessageKind("error");
				setMessage(
					err?.message?.includes?.("Permission")
						? "Camera permission denied. Allow camera access or enter the QR code manually."
						: "Camera could not start. Enter the QR code manually or try again.",
				);
				setRecallScanning(false);
				stopRecallCamera();
			}
		})();

		return () => {
			cancelled = true;
			stopRecallCamera();
		};
	}, [recallScanning, session?.id, session?.status, stopRecallCamera]);

	const toggleRecallCamera = () => {
		if (recallScanning) {
			stopRecallCamera();
			setRecallScanning(false);
			return;
		}
		// Never fight the main loading-scan camera for the hardware.
		stopCamera();
		setScanning(false);
		setMessage("");
		setRecallScanning(true);
	};

	const toggleCamera = () => {
		if (!session || session.status !== "ACTIVE" || allScanned) return;
		if (scanning) {
			stopCamera();
			setScanning(false);
		} else {
			// Never fight the recall camera for the hardware.
			stopRecallCamera();
			setRecallScanning(false);
			setMessage("");
			setScanning(true);
		}
	};

	const openCancelDialog = () => {
		const target = session ?? activeSession;
		if (!target) return;
		if (target.scanned > 0) {
			setMessageKind("warning");
			setMessage(
				"Cancelling is only possible before the first scan. Finalise this session instead.",
			);
			return;
		}
		setScanning(false);
		stopCamera();
		setCancelOpen(true);
	};

	const cancelSession = async () => {
		const target = session ?? activeSession;
		if (!target || cancelling) return;
		setCancelling(true);
		try {
			await api.loadingSessions.cancel(target.id);
			const orderId = target.dispatch_order_id;
			setCancelOpen(false);
			setSession(null);
			setActiveSession(null);
			setRecentScans([]);
			setLastScan(null);
			setLastSyncedAt(null);
			setPollError(false);
			setScanning(false);
			stopCamera();
			setSealNumber("");
			setRemarks("");
			setOutcome("DISPATCHED");
			setSelectedOrderId(orderId);
			setMessageKind("success");
			setMessage(
				`Loading session cancelled for order #${orderId}. The batch is ready to be loaded again.`,
			);
			await Promise.all([loadOrders(), loadToday()]);
		} catch (err: any) {
			setCancelOpen(false);
			setMessageKind("error");
			setMessage(
				err?.message ||
					"Could not cancel the loading session. Please retry.",
			);
			await Promise.all([loadOrders(), loadActiveSession()]);
		} finally {
			setCancelling(false);
		}
	};

	const finalise = async () => {
		if (!session) return;
		if (
			!driverName.trim() ||
			!vehicleNumber.trim() ||
			!containerNumber.trim()
		) {
			setMessageKind("error");
			setMessage(
				"This order is missing the transporter name, vehicle, or container. They can only be set when the order is raised — cancel it and create a new one.",
			);
			return;
		}
		setFinalising(true);
		setMessage("");
		try {
			const response = await api.loadingSessions.finalise(session.id, {
				seal_number: sealNumber.trim(),
				outcome,
				driver_name: driverName.trim(),
				driver_phone: driverPhone.trim() || undefined,
				vehicle_number: vehicleNumber.trim(),
				container_number: containerNumber.trim(),
				remarks: remarks.trim() || undefined,
				client_operation_id: operationId(),
			});
			setFinaliseResult(response ?? {});
			setReloadPending(0);
			setSealedRecallQr("");
			setSealedRecallReason("");
			setMessageKind("success");
			setMessage(
				outcome === "DISPATCHED"
					? `Loading session finalised. ${Number(response?.loaded_quantity ?? session.scanned).toLocaleString()} loaded units were removed from inventory and the order is marked dispatched.`
					: "Loading session finalised. The order is marked NOT dispatched.",
			);
			setScanning(false);
			stopCamera();
			setSession(null);
			setActiveSession(null);
			setSelectedOrderId("");
			setRecentScans([]);
			setLastScan(null);
			setLastSyncedAt(null);
			setPollError(false);
			setSealNumber("");
			setDriverName("");
			setDriverPhone("");
			setVehicleNumber("");
			setContainerNumber("");
			setRemarks("");
			setOutcome("DISPATCHED");
			const next = new URLSearchParams(searchParams);
			next.delete("order");
			setSearchParams(next, { replace: true });
			await Promise.all([loadOrders(), loadToday()]);
		} catch (err: any) {
			setMessageKind("error");
			setMessage(
				err?.message ||
					"Could not finalise the loading session. Please retry.",
			);
		} finally {
			setFinalising(false);
		}
	};

	const saveSealNumber = async () => {
		const sessionId = finaliseResult?.session?.id;
		if (!sessionId || savingSeal) return;
		setSavingSeal(true);
		try {
			const result = await api.loadingSessions.setSeal(
				sessionId,
				sealEditValue.trim(),
			);
			setFinaliseResult((current: any) =>
				current
					? {
							...current,
							session: {
								...current.session,
								seal_number: result.seal_number,
							},
						}
					: current,
			);
			setSealEditOpen(false);
			setMessageKind("success");
			setMessage(
				result.seal_number
					? `Seal number saved: ${result.seal_number}`
					: "Seal number cleared.",
			);
		} catch (err: any) {
			setMessageKind("error");
			setMessage(err?.message || "Could not save the seal number.");
		} finally {
			setSavingSeal(false);
		}
	};

	const scannedCount = session?.scanned ?? 0;
	const totalCount = session?.total ?? 0;
	const progress = percent(scannedCount, totalCount);
	const remaining = Math.max(0, totalCount - scannedCount);
	const shortfall = session ? scannedCount < totalCount : false;

	const cancelTarget = session ?? activeSession;
	const canCancelSession = Boolean(
		cancelTarget &&
		cancelTarget.status === "ACTIVE" &&
		cancelTarget.scanned === 0,
	);

	const MessageIcon =
		messageKind === "success"
			? CheckCircle
			: messageKind === "error"
				? XCircle
				: messageKind === "warning"
					? AlertTriangle
					: Clock;

	const LastScanIcon =
		lastScan?.result === "OK"
			? CheckCircle
			: lastScan?.result === "DUPLICATE" || lastScan?.result === "RECALLED"
				? AlertTriangle
				: XCircle;

	return (
		<div className="page-container mx-auto max-w-7xl">
			<div className="page-header">
				<div>
					<h1 className="page-title text-2xl sm:text-3xl">Loading &amp; Scan</h1>
					<p className="page-subtitle max-w-3xl text-sm leading-relaxed sm:text-base">
						Start a loading session, scan every unit, then seal and
						finalise the dispatch.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Link
						to="/dispatch-orders"
						className="btn-secondary btn-sm min-h-10 text-sm"
					>
						<ClipboardList size={14} /> Dispatch Orders
					</Link>
					<Link
						to="/dispatch-dashboard"
						className="btn-secondary btn-sm min-h-10 text-sm"
					>
						<Truck size={14} /> Dispatch Dashboard
					</Link>
				</div>
			</div>

			{message && (
				<div
					className={`mb-5 flex items-start gap-3 rounded-xl border p-4 text-sm sm:text-base ${MESSAGE_STYLES[messageKind]}`}
					role="status"
					aria-live="polite"
				>
					<MessageIcon size={16} className="mt-0.5 shrink-0" />
					<span className="min-w-0">{message}</span>
					<button
						className="ml-auto shrink-0 opacity-60 hover:opacity-100"
						onClick={() => setMessage("")}
						aria-label="Dismiss message"
					>
						<X size={14} />
					</button>
				</div>
			)}

			{!session && (
				<>
					{finaliseResult && (
						<div className="card mb-4 border border-emerald-200 bg-emerald-50/40 p-6">
							<div className="flex items-start gap-3">
								<CheckCircle
									size={22}
									className="mt-0.5 shrink-0 text-emerald-600"
								/>
								<div className="min-w-0 flex-1">
									<h2 className="section-title">
										Loading session finalised
									</h2>
									<p className="mt-1 text-xs text-surface-500">
										The outcome was saved. The seal number can
										be added here later, once the container is
										physically sealed. Loaded units have been
										deducted from inventory.
									</p>
									<div className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
										<div>
											<div className="text-surface-500">
												Order
											</div>
											<div className="font-medium text-surface-800">
												#
												{finaliseResult?.session
													?.dispatch_order_id ??
													finaliseResult?.order_id ??
													"-"}
											</div>
										</div>
										<div>
											<div className="text-surface-500">
												Order status
											</div>
											<div className="font-medium text-surface-800">
												{finaliseResult?.order_status ??
													"-"}
											</div>
										</div>
										<div>
											<div className="text-surface-500">
												Units deducted
											</div>
											<div className="font-semibold text-emerald-700">
												{Number(
													finaliseResult?.loaded_quantity ??
														0,
												).toLocaleString()}
											</div>
										</div>
										<div>
											<div className="text-surface-500">
												Seal number
											</div>
											<div className="font-mono font-medium text-surface-800">
												{finaliseResult?.session
													?.seal_number ?? "Not recorded"}
											</div>
											<button
												type="button"
												className="btn-ghost btn-sm mt-1"
												onClick={() => {
													setSealEditValue(
														finaliseResult?.session?.seal_number ?? "",
													);
													setSealEditOpen((open) => !open);
												}}
											>
												<ShieldCheck size={12} />
												{finaliseResult?.session?.seal_number
													? "Edit seal number"
													: "Add seal number"}
											</button>
											{sealEditOpen && (
												<div className="mt-2 flex items-center gap-1.5">
													<input
														className="input h-9 min-w-0 flex-1 font-mono text-xs"
														placeholder="Seal tag number"
														aria-label="Seal number"
														value={sealEditValue}
														onChange={(event) =>
															setSealEditValue(event.target.value)
														}
														onKeyDown={(event) => {
															if (event.key === "Enter")
																void saveSealNumber();
														}}
													/>
													<button
														type="button"
														className="btn-primary btn-sm shrink-0"
														disabled={savingSeal}
														onClick={() => void saveSealNumber()}
													>
														{savingSeal ? (
															<Loader2
																size={12}
																className="animate-spin"
															/>
														) : (
															<CheckCircle size={12} />
														)}
														Save
													</button>
												</div>
											)}
										</div>
									</div>
									<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
										<div className="flex items-start gap-2">
											<RotateCcw
												size={16}
												className="mt-0.5 shrink-0 text-amber-700"
											/>
											<div className="min-w-0 flex-1">
												<h3 className="text-sm font-bold text-slate-900">
													Recall a sealed unit
												</h3>
												<p className="mt-0.5 text-xs leading-relaxed text-slate-600">
													Found a damaged or wrong unit inside the
													sealed container? Recall it here. If a
													replacement is required, reopen the order with
													"Reload new product" and load the new QR label
													against the same dispatch order.
												</p>
												<div className="mt-3 grid gap-2 sm:grid-cols-2">
													<input
														className="input font-mono text-sm"
														value={sealedRecallQr}
														onChange={(event) =>
															setSealedRecallQr(event.target.value)
														}
														placeholder="Scan or enter the sealed QR code"
														autoComplete="off"
														aria-label="Sealed unit QR code"
													/>
													<select
														className="input"
														value={sealedRecallCondition}
														onChange={(event) =>
															setSealedRecallCondition(
																event.target.value as typeof sealedRecallCondition,
															)
														}
														aria-label="Recall condition"
													>
														{RECALL_CONDITIONS.map((condition) => (
															<option
																key={condition.value}
																value={condition.value}
															>
																{condition.label}
															</option>
														))}
													</select>
													<p className="sm:col-span-2 text-[11px] leading-snug text-surface-500">
														{recallConditionHint(sealedRecallCondition)}
													</p>
													<input
														className="input sm:col-span-2"
														value={sealedRecallReason}
														onChange={(event) =>
															setSealedRecallReason(event.target.value)
														}
														placeholder="Describe why this sealed unit is being recalled"
														aria-label="Recall reason"
													/>
												</div>
												<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
													<button
														type="button"
														className="btn-secondary btn-sm"
														onClick={() => void submitSealedRecall()}
														disabled={
															sealedRecalling ||
															!sealedRecallQr.trim() ||
															!sealedRecallReason.trim()
														}
													>
														{sealedRecalling ? (
															<Loader2 size={15} className="animate-spin" />
														) : (
															<RotateCcw size={15} />
														)}
														{sealedRecalling
															? "Recalling…"
															: "Recall sealed unit"}
													</button>
													{reloadPending > 0 && (
														<button
															type="button"
															className="btn-primary btn-sm"
															onClick={() =>
																void reloadReplacementOrder()
															}
															disabled={reloading}
														>
															{reloading ? (
																<Loader2 size={15} className="animate-spin" />
															) : (
																<Boxes size={15} />
															)}
															{reloading
																? "Reloading…"
																: `Reload new product (${reloadPending} unit${reloadPending > 1 ? "s" : ""})`}
														</button>
													)}
												</div>
												{reloadPending > 0 && (
													<p className="mt-2 text-xs font-semibold text-amber-800">
														{reloadPending} replacement unit(s)
														pending for this order. Reopening it lets
														you scan the new QR labels and seal again.
													</p>
												)}
											</div>
										</div>
									</div>
									<button
										className="btn-secondary btn-sm mt-4"
										onClick={() => setFinaliseResult(null)}
									>
										Dismiss
									</button>
								</div>
							</div>
						</div>
					)}

					{activeSession && (
						<div className="card mb-4 overflow-hidden border border-brand-200">
							<div className="flex flex-wrap items-start justify-between gap-4 border-l-4 border-l-brand-500 p-4 sm:p-6">
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<span className="badge badge-success">
											<span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
											ACTIVE SESSION
										</span>
										<span className="badge badge-info">
											Order #
											{orderNumber(activeSession)}
										</span>
										<span className="rounded-lg bg-surface-100 px-2 py-1 font-mono text-xs text-surface-700">
											Batch{" "}
											{activeSession.batch_number || "-"}
										</span>
									</div>
									<h2 className="mt-2 flex items-center gap-2 text-lg font-bold text-surface-900">
										<QrCode
											size={18}
											className="text-brand-500"
										/>
										Loading already in progress
									</h2>
									<p className="mt-1 text-sm text-surface-500">
										{gradeLabel(activeSession)}{" "}
										· {activeSession.scanned}/
										{activeSession.total} units scanned
										{activeSession.client_name
											? ` · ${activeSession.client_name}`
											: ""}
									</p>
									<p className="mt-2 text-sm text-surface-500">
										Started{" "}
										{formatDateTime(
											activeSession.started_at,
										)}
										. Resume it to keep scanning instead of
										starting a duplicate.
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<button
										className="btn-primary"
										onClick={() =>
											void resumeSession(activeSession)
										}
									>
										<QrCode size={16} /> Resume session
									</button>
									{activeSession.scanned === 0 && (
										<button
											className="btn-secondary border-rose-200 text-rose-600 hover:bg-rose-50"
											onClick={openCancelDialog}
											disabled={cancelling}
										>
											<XCircle size={16} /> Cancel session
										</button>
									)}
								</div>
							</div>
						</div>
					)}

					<div className="card mb-5 overflow-hidden p-0">
						{/* Toolbar — stays put while the list scrolls */}
						<div className="border-b border-surface-100 p-4 sm:p-5">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="min-w-0">
									<h2 className="section-title flex items-center gap-2 text-lg">
										<PackageCheck
											size={17}
											className="text-brand-500"
										/>{" "}
										Ready for loading
										<span className="badge badge-neutral">
											{filteredOrders.length}
										</span>
										{checkingActive && (
											<Loader2
												size={13}
												className="animate-spin text-surface-400"
												aria-label="Checking active sessions"
											/>
										)}
									</h2>
									<p className="mt-0.5 text-xs text-surface-500">
										{orders.length} open order
										{orders.length === 1 ? "" : "s"}
										{filteredOrders.length !== orders.length
											? ` · ${filteredOrders.length} matching`
											: ""}
										· {filteredUnits.toLocaleString()} unit
										{filteredUnits === 1 ? "" : "s"} to load
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<button
										type="button"
										className="btn-secondary btn-sm min-h-10"
										onClick={() => setSortAsc((v) => !v)}
										title={
											sortAsc
												? "Showing oldest orders first — switch to newest"
												: "Showing newest orders first — switch to oldest"
										}
									>
										<ArrowUpDown size={14} />
										{sortAsc ? "Oldest" : "Newest"}
									</button>
									<button
										type="button"
										className="btn-secondary btn-sm min-h-10"
										onClick={() =>
											void Promise.all([
												loadOrders(),
												loadActiveSession(),
											])
										}
										disabled={ordersLoading}
									>
										<RefreshCw
											size={14}
											className={
												ordersLoading ? "animate-spin" : ""
											}
										/>{" "}
										Refresh
									</button>
								</div>
							</div>

							<div className="relative mt-3">
								<Search
									size={16}
									className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
								/>
								<input
									ref={orderSearchRef}
									className="input min-h-12 w-full pl-9 pr-10 text-base"
									placeholder="Search by grade, order number, batch, client, vehicle or QR… — press / to focus"
									value={orderSearch}
									onChange={(event) =>
										setOrderSearch(event.target.value)
									}
									aria-label="Search dispatch orders"
								/>
								{orderSearch && (
									<button
										type="button"
										className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700"
										onClick={() => setOrderSearch("")}
										aria-label="Clear search"
									>
										<X size={15} />
									</button>
								)}
							</div>
						</div>

						{/* Column headers — fixed above the scroll area */}
						<div className="hidden gap-4 border-b border-surface-100 bg-surface-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-surface-400 lg:grid lg:grid-cols-[8.5rem_minmax(0,1.6fr)_minmax(0,1.2fr)_9rem_minmax(0,1.2fr)_auto]">
							<span>Order</span>
							<span>Grade</span>
							<span>Client / Transporter</span>
							<span className="text-right">To load</span>
							<span>Vehicle / Container</span>
							<span className="text-right">Action</span>
						</div>

						<div className="max-h-[60vh] overflow-y-auto sm:max-h-[32rem]">
							{ordersLoading && orders.length === 0 && (
								<div aria-hidden>
									{[0, 1, 2, 3].map((row) => (
										<div
											key={row}
											className="animate-pulse border-b border-surface-100 px-4 py-4 sm:px-5"
										>
											<div className="flex items-center gap-4">
												<div className="h-4 w-20 rounded bg-surface-100" />
												<div className="h-4 flex-1 rounded bg-surface-100" />
												<div className="hidden h-4 w-28 rounded bg-surface-100 lg:block" />
												<div className="h-9 w-32 rounded-xl bg-surface-100" />
											</div>
										</div>
									))}
								</div>
							)}
							{visibleOrders.map((order) => {
								const isSelected =
									String(order.id) === selectedOrderId;
								const isStartingThis =
									starting &&
									startingOrderId === String(order.id);
								return (
									<div
										key={String(order.id)}
										role="button"
										tabIndex={0}
										aria-pressed={isSelected}
										onClick={() =>
											selectOrder(String(order.id))
										}
										onKeyDown={(event) => {
											if (
												event.key === "Enter" ||
												event.key === " "
											) {
												event.preventDefault();
												selectOrder(String(order.id));
											}
										}}
										className={`relative cursor-pointer border-b border-surface-100 px-4 py-3 outline-none transition-colors last:border-0 focus-visible:bg-brand-50 sm:px-5 lg:grid lg:grid-cols-[8.5rem_minmax(0,1.6fr)_minmax(0,1.2fr)_9rem_minmax(0,1.2fr)_auto] lg:items-center lg:gap-4 ${
											isSelected
												? "bg-brand-50/70 ring-1 ring-inset ring-brand-200"
												: "hover:bg-surface-50"
										}`}
									>
										{isSelected && (
											<span
												className="absolute inset-y-0 left-0 w-1 bg-brand-600"
												aria-hidden
											/>
										)}

										{/* Order # + when it was raised */}
										<div className="flex items-center justify-between gap-2 lg:block">
											<span className="font-mono text-sm font-bold text-surface-900">
												#{orderNumber(order)}
											</span>
											<span className="text-[11px] text-surface-400 lg:mt-0.5 lg:block">
												{formatDateTime(order.created_at)}
											</span>
										</div>

										{/* Grade — the headline the operator scans for */}
										<div className="mt-1.5 min-w-0 lg:mt-0">
											<div
												className="truncate text-sm font-semibold text-surface-900"
												title={gradeLabel(order)}
											>
												{gradeLabel(order)}
											</div>
											<div className="mt-0.5 truncate font-mono text-[11px] text-surface-500">
												{order.batch_number || "-"}
											</div>
										</div>

										{/* Client + transporter */}
										<div className="mt-1.5 min-w-0 lg:mt-0">
											<div
												className="truncate text-sm font-medium text-surface-700"
												title={
													order.client_name || undefined
												}
											>
												{order.client_name || "-"}
											</div>
											<div className="truncate text-[11px] text-surface-400">
												{order.driver_name ||
													"No transporter"}
											</div>
										</div>

										{/* Quantity to load */}
										<div className="mt-1.5 flex items-baseline justify-between gap-2 lg:mt-0 lg:block lg:text-right">
											<span className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 lg:hidden">
												To load
											</span>
											<span className="text-sm font-bold tabular-nums text-surface-900">
												{Number(
													order.quantity,
												).toLocaleString()}{" "}
												<span className="font-medium text-surface-500">
													{order.uom || "units"}
												</span>
											</span>
										</div>

										{/* Vehicle + container */}
										<div className="mt-1.5 min-w-0 lg:mt-0">
											<div className="truncate font-mono text-xs font-medium text-surface-700">
												{order.vehicle_number ||
													"No vehicle"}
											</div>
											<div className="truncate text-[11px] text-surface-400">
												{order.container_number
													? `Container ${order.container_number}`
													: "No container"}
											</div>
										</div>

										{/* One click: select this order and start loading */}
										<div className="mt-2.5 flex justify-end lg:mt-0">
											<button
												type="button"
												className="btn-primary btn-sm min-h-10 whitespace-nowrap"
												onClick={(event) => {
													event.stopPropagation();
													selectOrder(
														String(order.id),
													);
													void startSession(order);
												}}
												disabled={starting}
											>
												{isStartingThis ? (
													<Loader2
														size={14}
														className="animate-spin"
													/>
												) : (
													<Play size={14} />
												)}
												{isStartingThis
													? "Starting…"
													: "Start Loading"}
											</button>
										</div>
									</div>
								);
							})}
							{!ordersLoading && filteredOrders.length === 0 && (
								<div className="p-8 text-center">
									<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-100">
										<PackageCheck
											size={22}
											className="text-surface-400"
										/>
									</div>
									<div className="text-sm font-semibold text-surface-700">
										{orderSearch
											? "No dispatch orders match that search"
											: "No dispatch orders ready for loading"}
									</div>
									<div className="mt-1 text-sm text-surface-500">
										{orderSearch
											? "Try a grade, order number, batch, client or vehicle."
											: "Create a dispatch order from a stocked batch to begin loading."}
									</div>
								</div>
							)}
						</div>

						{/* Window footer — grow the list on demand */}
						{filteredOrders.length > 0 && (
							<div className="border-t border-surface-100 px-4 py-3 text-center sm:px-5">
								{filteredOrders.length > visibleCount ? (
									<button
										type="button"
										className="btn-secondary btn-sm min-h-10"
										onClick={() =>
											setVisibleCount((count) =>
												count + PAGE_STEP,
											)
										}
									>
										<ChevronDown size={14} /> Show more (
										{filteredOrders.length - visibleCount}{" "}
										remaining)
									</button>
								) : (
									<span className="text-[11px] text-surface-400">
										Showing all {filteredOrders.length}{" "}
										order
										{filteredOrders.length === 1 ? "" : "s"}
									</span>
								)}
							</div>
						)}
					</div>

					{selectedOrder && (
						<div className="card mb-5 overflow-hidden border-l-4 border-l-brand-500 p-0">
							<div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="badge badge-info">
											Order #{orderNumber(selectedOrder)}
										</span>
										<span className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">
											Selected — ready to load
										</span>
									</div>
									<h2
										className="mt-1.5 truncate text-xl font-bold text-surface-900"
										title={gradeLabel(selectedOrder)}
									>
										{gradeLabel(selectedOrder)}
									</h2>
									<div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-surface-600">
										<span>
											<span className="text-surface-400">
												Batch:{" "}
											</span>
											<strong className="font-mono text-surface-800">
												{selectedOrder.batch_number ||
													"-"}
											</strong>
										</span>
										<span>
											<span className="text-surface-400">
												To load:{" "}
											</span>
											<strong className="text-surface-800">
												{Number(
													selectedOrder.quantity || 0,
												).toLocaleString()}{" "}
												{selectedOrder.uom || "units"}
											</strong>
										</span>
										<span>
											<span className="text-surface-400">
												Client:{" "}
											</span>
											<strong className="text-surface-800">
												{selectedOrder.client_name ||
													"-"}
											</strong>
										</span>
										<span>
											<span className="text-surface-400">
												Transporter:{" "}
											</span>
											<strong className="text-surface-800">
												{selectedOrder.driver_name ||
													"-"}
											</strong>
										</span>
										<span>
											<span className="text-surface-400">
												Vehicle / Container:{" "}
											</span>
											<strong className="font-mono text-surface-800">
												{selectedOrder.vehicle_number ||
													"-"}{" "}
												/{" "}
												{selectedOrder.container_number ||
													"-"}
											</strong>
										</span>
									</div>
								</div>
								<button
									className="btn-primary min-h-12 w-full shrink-0 px-6 text-base sm:w-auto"
									onClick={() => void startSession()}
									disabled={starting}
								>
									{starting ? (
										<Loader2
											size={16}
											className="animate-spin"
										/>
									) : (
										<Play size={16} />
									)}
									{starting
										? "Starting..."
										: "Start Loading Session"}
								</button>
							</div>
						</div>
					)}
				</>
			)}

			{session && session.status !== "ACTIVE" && (
				<div className="card mb-4 border border-amber-200 bg-amber-50/50 p-6">
					<div className="flex items-start gap-3">
						<AlertTriangle
							size={22}
							className="mt-0.5 shrink-0 text-amber-600"
						/>
						<div className="min-w-0 flex-1">
							<h2 className="section-title">
								Session {session.status}
							</h2>
							<p className="mt-1 text-sm text-surface-600">
								This loading session is no longer active. Choose
								an open dispatch order to start a new session.
							</p>
							<button
								className="btn-secondary btn-sm mt-4"
								onClick={resetToOrders}
							>
								Back to orders
							</button>
						</div>
					</div>
				</div>
			)}

			{session && session.status === "ACTIVE" && (
				<>
					<div className="card mb-4 overflow-hidden">
						<div 						className="border-b border-surface-100 bg-gradient-to-r from-brand-50 via-white to-white px-4 py-5 sm:px-6 sm:py-6">
							<div className="flex flex-wrap items-start justify-between gap-4">
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<span className="badge badge-success">
											<span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
											{session.status}
										</span>
										<span className="badge badge-info">
											Order #
											{orderNumber(session)}
										</span>
										<span className="rounded-lg bg-white px-3 py-1.5 font-mono text-sm text-surface-800 ring-1 ring-surface-200">
											Batch {session.batch_number || "-"}
										</span>
									</div>
									<h2 className="mt-3 flex items-center gap-2 text-xl font-bold tracking-tight text-surface-900 sm:text-2xl">
										<QrCode
											size={18}
											className="text-brand-500"
										/>
										{session.grade_name ||
											session.product_name ||
											"Loading in progress"}
									</h2>
									<p className="mt-2 text-sm leading-relaxed text-surface-600">
										{session.client_name || "Client"} ·
										Transporter Name:{" "}
										{session.driver_name || "-"} ·{" "}
										{session.vehicle_number || "No vehicle"}
										{session.container_number
											? ` · Container ${session.container_number}`
											: ""}
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									{canCancelSession ? (
										<button
											className="btn-secondary btn-sm border-rose-200 text-rose-600 hover:bg-rose-50"
											onClick={openCancelDialog}
											disabled={cancelling}
										>
											<XCircle size={14} /> Cancel session
										</button>
									) : (
										<span
											className="text-[11px] text-surface-400"
											title="Cancelling is only available before the first scan"
										>
											Cancel available before first scan
										</span>
									)}
								</div>
							</div>
						</div>

						<div className="grid gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
							<div className="min-w-0 space-y-5">
								<div
									className={`overflow-hidden rounded-2xl border shadow-sm ${allScanned ? "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white" : "border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white"}`}
								>
									<div className="p-5 sm:p-6">
										<div className="flex flex-wrap items-end justify-between gap-4">
											<div>
												<div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-surface-600">
													<ScanLine
														size={14}
														className="text-brand-500"
													/>
													Scanned units
												</div>
												<div className="mt-1 text-6xl font-bold tabular-nums tracking-tight text-surface-900 sm:text-7xl">
													{scannedCount}
													<span className="text-4xl font-semibold text-surface-400 sm:text-5xl">
														{" "}
														/ {totalCount}
													</span>
												</div>
											</div>
											<div className="text-right">
												<div
													className={`text-4xl font-bold tabular-nums ${progress >= 100 ? "text-emerald-600" : "text-brand-700"}`}
												>
													{progress}%
												</div>
												<div className="mt-1 text-sm text-surface-600">
													{remaining === 0 ? (
														<span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
															<CheckCircle
																size={14}
															/>
															All units scanned
														</span>
													) : (
														`${remaining} unit${remaining === 1 ? "" : "s"} remaining`
													)}
												</div>
											</div>
										</div>
										<div
											className="mt-5 h-4 w-full overflow-hidden rounded-full bg-surface-200"
											role="progressbar"
											aria-valuemin={0}
											aria-valuemax={100}
											aria-valuenow={progress}
											aria-label="Loading progress"
										>
											<div
												className={`h-full rounded-full transition-all duration-300 ${progress >= 100 ? "bg-emerald-500" : "bg-brand-500"}`}
												style={{ width: `${progress}%` }}
											/>
										</div>
										<div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-surface-600">
											<span>
												{lastSyncedAt
													? `Last sync ${formatTime(lastSyncedAt)}`
													: "Live counter"}
											</span>
											{pollError ? (
												<span className="flex items-center gap-1 text-amber-600">
													<AlertTriangle size={12} />{" "}
													Connection issue — retrying
												</span>
											) : (
												<span className="flex items-center gap-1 text-emerald-600">
													<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{" "}
													Live
												</span>
											)}
										</div>
									</div>

									<div className="border-t border-surface-100 bg-white/70 p-4 sm:p-5">
								<div>
									<div className="mb-2 flex items-center justify-between gap-2">
										<label
											className="flex items-center gap-1.5 text-sm font-semibold text-surface-700"
											htmlFor="manual-scan"
										>
											<QrCode
												size={14}
												className="text-brand-500"
											/>
											Unit QR code
										</label>
										<span className="text-xs text-surface-400">
											{allScanned
												? "Load complete"
												: "Scanner-ready · press Enter to submit"}
										</span>
									</div>
									<div className="flex flex-col gap-2 sm:flex-row">
										<input
											id="manual-scan"
											ref={manualScanRef}
											className={`input min-h-14 flex-1 font-mono text-base sm:text-lg ${allScanned ? "border-emerald-300 bg-emerald-50/60" : ""}`}
											placeholder={
												allScanned
													? "All units scanned — ready to finalise"
													: "Scan or type a unit QR code, then press Enter"
											}
											value={manualValue}
											onChange={(event) =>
												setManualValue(
													event.target.value,
												)
											}
											onKeyDown={(event) => {
												if (event.key === "Enter")
													submitManual();
											}}
											disabled={scanBusy || allScanned}
											autoComplete="off"
											spellCheck={false}
										/>
										<button
											type="button"
											className="btn-secondary min-h-14 w-full text-base sm:w-auto"
											onClick={submitManual}
											disabled={
												!manualValue.trim() ||
												scanBusy ||
												allScanned
											}
										>
											{scanBusy ? (
												<Loader2
													size={16}
													className="animate-spin"
												/>
											) : (
												<CheckCircle size={16} />
											)}
											{scanBusy
												? "Checking..."
												: "Add scan"}
										</button>
										<button
											type="button"
											className="btn-primary min-h-14 w-full text-base sm:w-auto"
											onClick={toggleCamera}
											disabled={allScanned}
										>
											{scanning ? (
												<X size={16} />
											) : (
												<Camera size={16} />
											)}
											{scanning
												? "Stop camera"
												: "Scan with camera"}
										</button>
									</div>

									{lastScan && (
										<div
											key={lastScan.at}
											className={`mt-3 flex items-start gap-3 rounded-xl border p-4 ${INLINE_STYLES[lastScan.result].wrap}`}
											role="status"
											aria-live="polite"
										>
											<LastScanIcon
												size={22}
												className="mt-0.5 shrink-0"
											/>
											<div className="min-w-0 flex-1">
												<div className="text-base font-semibold">
													{
														INLINE_STYLES[
															lastScan.result
														].label
													}
												</div>
												<div
													className="truncate font-mono text-sm opacity-80"
													title={lastScan.qr}
												>
													{lastScan.qr}
												</div>
											</div>
											<span className="shrink-0 text-xs opacity-80">
												{formatTime(lastScan.at)}
											</span>
										</div>
									)}

									<p
										className={`mt-2.5 text-sm leading-relaxed ${allScanned ? "font-medium text-emerald-700" : "text-surface-500"}`}
									>
										{allScanned
											? "All units are scanned. Add the seal number below and finalise the dispatch."
											: "The camera stays on between scans. Press Enter to submit a typed code."}
									</p>
								</div>

								{scanning && (
									<div className="space-y-3">
										<div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-surface-200">
											<video
												ref={videoRef}
												className="h-64 w-full object-cover sm:h-80 lg:h-[420px]"
												playsInline
												muted
											/>
											<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
												<div className="h-48 w-48 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
											</div>
											<span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white">
												<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />{" "}
												Scanning
											</span>
										</div>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<span className="flex items-center gap-2 text-sm text-surface-600">
												<Camera size={14} /> Hold the QR
												inside the frame.
											</span>
											<button
												className="btn-secondary btn-sm min-h-10"
												onClick={toggleCamera}
											>
												<X size={14} /> Stop camera
											</button>
										</div>
									</div>
								)}

								<div
									className={`overflow-hidden rounded-2xl border ${recallOpen ? "border-amber-300 bg-amber-50/70" : "border-dashed border-amber-300 bg-amber-50/40"}`}
								>
									<button
										type="button"
										className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5"
										onClick={() => {
											// Collapsing must not leave the recall
											// camera running behind the scenes.
											if (recallOpen && recallScanning) {
												setRecallScanning(false);
												stopRecallCamera();
											}
											setRecallOpen((open) => !open);
										}}
										aria-expanded={recallOpen}
									>
										<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
											<RotateCcw size={16} />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-bold text-slate-900">
												Recall a product
											</span>
											<span className="mt-0.5 block text-xs leading-relaxed text-slate-600">
												Remove a damaged or wrongly loaded unit
												from this load — even if it has already
												been scanned.
											</span>
										</span>
										<span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-amber-700">
											{recallOpen ? "Hide" : "Open"}
										</span>
										<ChevronDown
											size={16}
											className={`shrink-0 text-amber-700 transition-transform ${recallOpen ? "rotate-180" : ""}`}
										/>
									</button>
									{recallOpen && (
										<div className="border-t border-amber-200 px-4 py-4 sm:px-5">
											<p className="mb-3 text-sm leading-relaxed text-slate-700">
												Only QRs from this batch are accepted.
												Use this if an item is damaged or
												cannot be loaded — even if it has already
												been scanned. Recalled QR codes are excluded
												from the load; scan a replacement unit
												before sealing.
											</p>
											<div className="grid gap-2 sm:grid-cols-2">
											<div>
											<label
												className="mb-1.5 block text-sm font-semibold text-surface-700"
												htmlFor="recall-qr"
											>
												Product QR code
											</label>
											<div className="flex gap-2">
												<input
													id="recall-qr"
													className="input min-w-0 flex-1 font-mono text-sm"
													value={recallQr}
													onChange={(event) =>
														setRecallQr(
															event.target.value,
														)
													}
													placeholder="Scan or enter QR code"
													autoComplete="off"
												/>
												<button
													type="button"
													className="btn-secondary shrink-0"
													onClick={toggleRecallCamera}
													aria-pressed={recallScanning}
												>
													<ScanLine size={15} />
													{recallScanning ? "Stop" : "Scan"}
												</button>
											</div>
											{recallScanning && (
												<div className="mt-2 overflow-hidden rounded-xl border border-amber-300 bg-black">
													<video
														ref={recallVideoRef}
														className="h-44 w-full object-cover"
														playsInline
														muted
													/>
													<div className="flex items-center justify-between gap-2 border-t border-amber-300 bg-amber-100 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
														<span>Point the camera at the bag's QR code…</span>
														<button
															type="button"
															className="underline underline-offset-2 hover:text-amber-900"
															onClick={toggleRecallCamera}
														>
															Stop
														</button>
													</div>
												</div>
											)}
										</div>
										<div>
											<label
												className="mb-1.5 block text-sm font-semibold text-surface-700"
												htmlFor="recall-condition"
											>
												Condition
											</label>
											<select
												id="recall-condition"
												className="input"
												value={recallCondition}
												onChange={(event) =>
													setRecallCondition(
														event.target
															.value as typeof recallCondition,
													)
												}
											>
												{RECALL_CONDITIONS.map((condition) => (
													<option
														key={condition.value}
														value={condition.value}
													>
														{condition.label}
													</option>
												))}
											</select>
											<p className="mt-1 text-[11px] leading-snug text-surface-500">
												{recallConditionHint(recallCondition)}
											</p>
										</div>
										<div className="sm:col-span-2">
											<label
												className="mb-1.5 block text-sm font-semibold text-surface-700"
												htmlFor="recall-reason"
											>
												Reason
											</label>
											<div className="flex flex-col gap-2 sm:flex-row">
												<input
													id="recall-reason"
													className="input flex-1"
													value={recallReason}
													onChange={(event) =>
														setRecallReason(
															event.target.value,
														)
													}
													placeholder="Describe why this item is being recalled"
												/>
												<button
													type="button"
													className="btn-secondary shrink-0"
													onClick={() =>
														void submitRecall()
													}
													disabled={
														recalling ||
														!recallQr.trim() ||
														!recallReason.trim()
													}
												>
													{recalling ? (
														<Loader2
															size={15}
															className="animate-spin"
														/>
													) : (
														<RotateCcw size={15} />
													)}
													{recalling
														? "Recalling…"
														: "Recall QR"}
												</button>
											</div>
										</div>
									</div>
											</div>
										)}
								</div>
									</div>
								</div>

							</div>

							<div className="min-w-0 space-y-4">
								<div className="rounded-2xl border border-surface-200 bg-white p-4">
									<h3 className="flex items-center gap-2 text-base font-semibold text-surface-900">
										<Boxes
											size={15}
											className="text-brand-500"
										/>{" "}
										Shipment details
									</h3>
									<dl className="mt-3 text-sm">
										<DetailRow
											label="Grade"
											value={
												session.grade_name ||
												session.product_name
											}
										/>
										<DetailRow
											label="Batch"
											value={session.batch_number}
											mono
										/>
										<DetailRow
											label="Client"
											value={session.client_name}
										/>
										<DetailRow
											label="Transporter Name"
											value={session.driver_name}
										/>
										<DetailRow
											label="Vehicle"
											value={session.vehicle_number}
											mono
										/>
										<DetailRow
											label="Container"
											value={session.container_number}
											mono
										/>
										<DetailRow
											label="Started"
											value={formatDateTime(
												session.started_at,
											)}
										/>
									</dl>
								</div>

								<div className="overflow-hidden rounded-2xl border border-surface-200 bg-white">
									<div className="flex items-center justify-between gap-2 border-b border-surface-100 px-4 py-3">
										<h3 className="flex items-center gap-2 text-sm font-semibold text-surface-800">
											<ScanLine
												size={15}
												className="text-brand-500"
											/>{" "}
											Recent scans
										</h3>
										<span className="badge badge-neutral">
											{recentScans.length}
										</span>
									</div>
									<div className="max-h-[420px] divide-y divide-surface-100 overflow-y-auto">
										{recentScans.map((scan) => (
											<div
												key={scan.key}
												className="flex items-center justify-between gap-3 px-4 py-2.5"
											>
												<div className="min-w-0">
													<div
														className="truncate font-mono text-sm font-medium text-surface-800"
														title={scan.qr}
													>
														{scan.qr}
													</div>
													<div className="mt-0.5 text-xs text-surface-500">
														{formatTime(scan.at)}
													</div>
												</div>
												<span
													className={`badge shrink-0 ${resultBadge(scan.result)}`}
												>
													{RESULT_LABELS[
														scan.result
													] || scan.result}
												</span>
											</div>
										))}
										{recentScans.length === 0 && (
											<div className="px-4 py-8 text-center text-xs text-surface-400">
												No scans yet. Scan the first
												unit QR to begin.
											</div>
										)}
									</div>
								</div>
							</div>
						</div>
					</div>

					<div className="card mb-6 p-4 sm:p-6">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="flex items-start gap-3">
								<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
									<ShieldCheck size={18} />
								</span>
								<div>
									<h2 className="section-title text-lg">
										Seal &amp; finalise
									</h2>
									<p className="mt-0.5 text-sm text-surface-500">
										Complete the shipment details after
										loading, then mark the order dispatched.
										Transporter mobile is optional.
									</p>
								</div>
							</div>
							<span
								className={`badge ${shortfall ? "badge-warning" : "badge-success"}`}
							>
								{scannedCount}/{totalCount} scanned
							</span>
						</div>

						{shortfall ? (
							<div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
								<AlertTriangle
									size={15}
									className="mt-0.5 shrink-0"
								/>
								<span>
									Only {scannedCount} of {totalCount} units
									are scanned. Finalising below total is
									allowed, but add remarks explaining the
									shortfall.
								</span>
							</div>
						) : (
							scannedCount > 0 && (
								<div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
									<CheckCircle
										size={15}
										className="mt-0.5 shrink-0"
									/>
									<span>
										All {totalCount} units are scanned.
										Complete the shipment details below to
										dispatch this order.
									</span>
								</div>
							)
						)}

						<div className="form-grid mt-4">
						<div>
							<label
									className="mb-1.5 block text-sm font-semibold text-surface-700"
									htmlFor="seal-number"
								>
									Seal number (optional)
								</label>
								<input
									id="seal-number"
									className="input font-mono"
									value={sealNumber}
									onChange={(event) =>
										setSealNumber(event.target.value)
									}
									autoComplete="off"
								/>
							</div>
							<div>
								<label
									className="mb-1.5 block text-sm font-semibold text-surface-700"
									htmlFor="outcome"
								>
									Order outcome
								</label>
								<select
									id="outcome"
									className="input"
									value={outcome}
									onChange={(event) =>
										setOutcome(
											event.target.value as Outcome,
										)
									}
								>
									<option value="DISPATCHED">
										DISPATCHED — loaded and dispatched
									</option>
									<option value="NOT_DISPATCHED">
										NOT DISPATCHED — loading not completed
									</option>
								</select>
							</div>
						</div>

						<div className="mt-4">
							<label className="mb-1.5 block text-sm font-semibold text-surface-700" htmlFor="remarks">
								Remarks{" "}
								{shortfall
									? "(recommended for shortfall)"
									: "(optional)"}
							</label>
							<textarea
								id="remarks"
								className="input"
								rows={3}
								placeholder={
									shortfall
										? "Explain why fewer units were loaded than expected"
										: "Optional notes about the loading / dispatch"
								}
								value={remarks}
								onChange={(event) =>
									setRemarks(event.target.value)
								}
							/>
						</div>

						<button
							className="btn-primary mt-5 min-h-12 w-full text-base"
							onClick={() => void finalise()}
							disabled={
								finalising ||
								!driverName.trim() ||
								!vehicleNumber.trim() ||
								!containerNumber.trim() ||
								scanBusy
							}
						>
							{finalising ? (
								<Loader2 size={16} className="animate-spin" />
							) : (
								<ShieldCheck size={16} />
							)}
							{finalising
								? "Finalising..."
								: `Finalise ${outcome === "DISPATCHED" ? "as dispatched" : "as not dispatched"}`}
						</button>
						<p className="mt-2 text-center text-xs text-surface-400">
							Inventory is reserved when the dispatch order is
							created. The final status and shipment details are
							saved here.
						</p>
					</div>
				</>
			)}

			<div className="card">
				<div className="card-header">
					<h3 className="section-title flex items-center gap-2">
						<Truck size={16} className="text-surface-400" />{" "}
						Dispatched Today
					</h3>
				</div>
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Grade</th>
								<th>Batch</th>
								<th>Time</th>
							</tr>
						</thead>
						<tbody>
							{todayDispatches.map((dispatch: any) => (
								<tr key={dispatch.id}>
									<td>
										<span className="font-medium text-surface-800">
											{dispatch.grade_name ||
												dispatch.product_name}
										</span>
									</td>
									<td>
										<span className="rounded-lg bg-surface-100 px-2 py-1 font-mono text-xs">
											{dispatch.batch_number}
										</span>
									</td>
									<td className="text-sm text-surface-500">
										{formatTime(dispatch.created_at)}
									</td>
								</tr>
							))}
							{todayDispatches.length === 0 && (
								<tr>
									<td colSpan={3}>
										<div className="empty-state">
											<div className="empty-icon">
												<Truck
													size={24}
													className="text-surface-400"
												/>
											</div>
											<div className="empty-title">
												No dispatches today
											</div>
										</div>
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>

			{cancelOpen && cancelTarget && (
				<div
					className="modal-overlay z-[60]"
					role="presentation"
					onClick={() => {
						if (!cancelling) setCancelOpen(false);
					}}
				>
					<section
						className="modal-content max-w-md"
						role="dialog"
						aria-modal="true"
						aria-labelledby="cancel-session-title"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="modal-header">
							<div className="min-w-0">
								<h2
									id="cancel-session-title"
									className="text-base font-semibold text-surface-900"
								>
									Cancel loading session?
								</h2>
								<p className="mt-1 text-xs text-surface-500">
									Order #
									{orderNumber(cancelTarget)} ·
									batch {cancelTarget.batch_number || "-"}
								</p>
							</div>
							<button
								className="btn-ghost btn-sm"
								aria-label="Close cancel dialog"
								disabled={cancelling}
								onClick={() => setCancelOpen(false)}
							>
								<X size={16} />
							</button>
						</div>
						<div className="modal-body space-y-3 text-sm text-surface-600">
							<p>
								No units have been scanned yet, so this session
								can be cancelled safely.
							</p>
							<div className="rounded-xl border border-surface-100 bg-surface-50 p-3 text-xs">
								<div className="flex justify-between gap-3">
									<span className="text-surface-400">
										Grade
									</span>
									<span className="truncate font-medium text-surface-700">
										{gradeLabel(cancelTarget)}
									</span>
								</div>
								<div className="mt-1 flex justify-between gap-3">
									<span className="text-surface-400">
										Batch
									</span>
									<span className="font-mono font-medium text-surface-700">
										{cancelTarget.batch_number || "-"}
									</span>
								</div>
								<div className="mt-1 flex justify-between gap-3">
									<span className="text-surface-400">
										Scanned
									</span>
									<span className="font-medium text-surface-700">
										0 of {cancelTarget.total}
									</span>
								</div>
							</div>
							<p className="text-xs text-surface-500">
								The batch returns to DISPATCH_APPROVED so it can
								be loaded again. No stock change or dispatch
								record is created.
							</p>
						</div>
						<div className="modal-footer">
							<button
								className="btn-secondary"
								onClick={() => setCancelOpen(false)}
								disabled={cancelling}
							>
								Keep loading
							</button>
							<button
								className="btn-danger"
								onClick={() => void cancelSession()}
								disabled={cancelling}
							>
								{cancelling ? (
									<Loader2
										size={16}
										className="animate-spin"
									/>
								) : (
									<XCircle size={16} />
								)}
								{cancelling
									? "Cancelling..."
									: "Cancel session"}
							</button>
						</div>
					</section>
				</div>
			)}
		</div>
	);
}