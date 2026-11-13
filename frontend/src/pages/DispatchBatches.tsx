import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	Boxes,
	ChevronDown,
	Minus,
	Plus,
	Send,
	Trash2,
	PackagePlus,
	X,
	Search,
} from "lucide-react";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { IsoDateInput } from "../components/IsoDateInput";
import { formatDateTime } from "../utils/dateFormat";

const batchStatusMeta: Record<
	string,
	{ label: string; className: string }
> = {
	PENDING_QC: { label: "Waiting for QC", className: "badge badge-warning" },
	QC_PASSED: { label: "QC Passed", className: "badge badge-success" },
	QC_FAILED: { label: "QC Failed", className: "badge badge-danger" },
	DISPATCH_ORDER_RAISED: {
		label: "Order Raised",
		className: "badge badge-info",
	},
	DISPATCH_APPROVED: { label: "Ready to Load", className: "badge badge-info" },
	LOADING: { label: "Loading", className: "badge badge-info" },
	DISPATCHED: { label: "Dispatched", className: "badge badge-success" },
};

type Line = {
	productId: string;
	quantity: string;
	packageQuantity: string;
	avgStandardQuantity: string;
	warehouseId: string;
	shelfLocationId: string;
	manufacturingDate: string;
	expiryDate: string;
};
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
/** Today's date as YYYY-MM-DD in the user's local timezone. */
function todayISO(): string {
	const now = new Date();
	const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

const newLine = (): Line => ({
	productId: "",
	quantity: "1",
	packageQuantity: "",
	avgStandardQuantity: "",
	warehouseId: "",
	shelfLocationId: "",
	manufacturingDate: todayISO(),
	expiryDate: "",
});

/** Idempotency key for one batch submission. */
function newOperationId(): string {
	return typeof crypto !== "undefined" && crypto.randomUUID
		? crypto.randomUUID()
		: `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Keep decimals but allow only one separator, and cap the typing length. */
const sanitizeDecimalInput = (value: string) => {
	const sanitized = value
		.replace(/[^0-9.]/g, "")
		.replace(/(\..*)\./g, "$1")
		.slice(0, 12);
	const [whole, fraction] = sanitized.split(".");
	return fraction === undefined ? whole : `${whole}.${fraction.slice(0, 4)}`;
};

function GodownSelector({
	warehouses,
	warehouseId,
	value,
	requiredQuantity,
	onChange,
}: {
	warehouses: Warehouse[];
	warehouseId: string;
	value: string;
	requiredQuantity: number;
	onChange: (warehouseId: string, locationId: string) => void;
}) {
	const selectedWarehouse = warehouses.find(
		(warehouse) => String(warehouse.id) === warehouseId,
	);
	const availableCells = (selectedWarehouse?.racks || [])
		.flatMap((rack) => rack.cells || [])
		.filter((cell) => !cell.occupied);
	const getAvailableCount = (warehouse: Warehouse) =>
		(warehouse.racks || [])
			.flatMap((rack) => rack.cells || [])
			.filter((cell) => !cell.occupied).length;
	return (
		<div className="grid grid-cols-1 gap-1">
			<select
				className="input min-w-0 border-slate-200 bg-white text-sm"
				aria-label="Godown"
				value={warehouseId}
				onChange={(event) => {
					const nextWarehouseId = event.target.value;
					const nextWarehouse = warehouses.find(
						(warehouse) => String(warehouse.id) === nextWarehouseId,
					);
					const nextCell = (nextWarehouse?.racks || [])
						.flatMap((rack) => rack.cells || [])
						.find((cell) => !cell.occupied);
					onChange(
						nextWarehouseId,
						nextCell?.shelf_location_id || "",
					);
				}}
			>
				<option value="">Select Location</option>
				{warehouses.map((warehouse) => {
					const freeCount = getAvailableCount(warehouse);
					return (
						<option
							key={warehouse.id}
							value={warehouse.id}
							disabled={
								freeCount === 0 &&
								String(warehouse.id) !== warehouseId
							}
						>
							{warehouse.name} · {freeCount} free
						</option>
					);
				})}
			</select>
			{warehouseId && availableCells.length < requiredQuantity && (
				<span
					role="alert"
					className="text-[11px] font-semibold text-rose-600"
				>
					Not enough empty positions: {availableCells.length} available
					for {requiredQuantity} bags. Add rack positions or reduce the
					bag count.
				</span>
			)}
		</div>
	);
}

function ProductPicker({
	products,
	value,
	onChange,
}: {
	products: any[];
	value: string;
	onChange: (productId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [panelStyle, setPanelStyle] = useState<{
		left: number;
		top?: number;
		bottom?: number;
		width: number;
		maxHeight: number;
		zIndex: number;
	} | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const positionPanel = () => {
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		const width = Math.max(rect.width, 320);
		const left = Math.min(
			Math.max(12, rect.left),
			Math.max(12, window.innerWidth - width - 12),
		);
		const spaceBelow = window.innerHeight - rect.bottom - 12;
		const spaceAbove = rect.top - 12;
		const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
		const maxHeight = Math.max(
			180,
			Math.min(320, openUp ? spaceAbove : spaceBelow),
		);
		setPanelStyle({
			left,
			width,
			maxHeight,
			zIndex: 1000,
			...(openUp
				? { bottom: window.innerHeight - rect.top + 4 }
				: { top: rect.bottom + 4 }),
		});
	};

	useEffect(() => {
		if (!open) {
			setPanelStyle(null);
			return;
		}
		positionPanel();
		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				containerRef.current?.contains(target) ||
				panelRef.current?.contains(target)
			) {
				return;
			}
			setOpen(false);
			setQuery("");
		};
		const handleReposition = () => positionPanel();
		document.addEventListener("mousedown", handlePointerDown);
		window.addEventListener("resize", handleReposition);
		window.addEventListener("scroll", handleReposition, true);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			window.removeEventListener("resize", handleReposition);
			window.removeEventListener("scroll", handleReposition, true);
		};
	}, [open]);

	const matches = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return products;
		return products.filter((product) =>
			[product?.name, product?.grade, product?.sku]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(q),
		);
	}, [products, query]);

	const label = (product: any) =>
		product?.grade
			// ? `${product.grade} · ${product.name}`
			? `${product.grade} || ${product.name}`
			: product?.name || product?.sku || "";

	const selected = products.find(
		(product) => String(product.id) === String(value),
	);

	const choose = (product: any) => {
		onChange(String(product.id));
		setOpen(false);
		setQuery("");
	};

	return (
		<div ref={containerRef} className="relative min-w-0 flex-1">
			<button
				type="button"
				ref={triggerRef}
				className="input flex h-10 w-full min-w-0 items-center justify-between gap-2 border-slate-200 bg-slate-50/50 pr-3 text-left font-semibold text-slate-800 focus:bg-white"
				onClick={() => {
					setOpen((current) => !current);
					setQuery("");
				}}
				aria-haspopup="listbox"
				aria-expanded={open}
				title={selected ? label(selected) : "Select product"}
			>
				<span
					className={`min-w-0 truncate ${
						selected ? "" : "text-slate-500"
					}`}
				>
					{selected ? label(selected) : "Select product"}
				</span>
				<ChevronDown size={16} className="shrink-0 text-slate-400" />
			</button>

			{open &&
				panelStyle &&
				createPortal(
					<div
						ref={panelRef}
						className="fixed flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
						style={panelStyle}
					>
					<div className="border-b border-slate-100 p-2">
						<div className="relative">
							<Search
								size={14}
								className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
							/>
							<input
								autoFocus
								className="input h-9 w-full pl-8 text-sm"
								value={query}
								onChange={(event) =>
									setQuery(event.target.value)
								}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										setOpen(false);
										setQuery("");
									}
									if (
										event.key === "Enter" &&
										matches.length > 0
									) {
										event.preventDefault();
										choose(matches[0]);
									}
								}}
								placeholder="Search product, grade or SKU"
								aria-label="Search products"
							/>
						</div>
					</div>
					<ul
						role="listbox"
						aria-label="Products"
						className="min-h-0 flex-1 overflow-y-auto py-1"
					>
						{matches.map((product) => {
							const isSelected =
								String(product.id) === String(value);
							return (
								<li key={product.id}>
									<button
										type="button"
										role="option"
										aria-selected={isSelected}
										className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
											isSelected
												? "bg-slate-100 font-bold text-slate-900"
												: "font-medium text-slate-700 hover:bg-slate-50"
										}`}
										onClick={() => choose(product)}
									>
										<span className="w-full whitespace-normal break-words">
											{label(product)}
										</span>
									</button>
								</li>
							);
						})}
						{matches.length === 0 && (
							<li className="px-3 py-3 text-sm font-medium text-slate-500">
								No products match your search.
							</li>
						)}
					</ul>
					</div>,
					document.body,
				)}
		</div>
	);
}

export default function DispatchBatches() {
	const operationIdRef = useRef(newOperationId());
	const [products, setProducts] = useState<any[]>([]);
	const [uoms, setUoms] = useState<any[]>([]);
	const [bagQuantities, setBagQuantities] = useState<any[]>([]);
	const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
	const [batches, setBatches] = useState<any[]>([]);
	const [lines, setLines] = useState<Line[]>([newLine()]);
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [useSameLocation, setUseSameLocation] = useState(false);
	const [useSameDates, setUseSameDates] = useState(false);
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

	const getPackageMaster = (product: any) =>
		bagQuantities.find(
			(row) => String(row.id) === String(product?.bag_quantity_id),
		) ||
		uoms.find((row) => String(row.id) === String(product?.bag_quantity_id));
	const getUom = (product: any) => {
		const value = getPackageMaster(product);
		return (
			value?.unit ||
			value?.name ||
			(value?.quantity ? `${value.quantity}` : "UOM not set")
		);
	};
	const getPackageDefault = (product: any) => {
		const quantity = getPackageMaster(product)?.quantity;
		return Number.isFinite(Number(quantity)) && Number(quantity) > 0
			? String(quantity)
			: "";
	};
	const updateLine = (index: number, patch: Partial<Line>) =>
		setLines((current) =>
			current.map((line, i) =>
				i === index ? { ...line, ...patch } : line,
			),
		);
	const hasValidPackageQuantity = (value: string) =>
		Number.isFinite(Number(value)) &&
		Number(value) > 0 &&
		Number(value) <= 1_000_000;
	const hasValidAvgQuantity = (value: string) =>
		value.trim() === "" ||
		(Number.isFinite(Number(value)) &&
			Number(value) >= 0 &&
			Number(value) <= 1_000_000);
	const setLineLocation = (
		index: number,
		warehouseId: string,
		locationId: string,
	) => {
		setLines((current) =>
			current.map((line, i) =>
				useSameLocation || i === index
					? { ...line, warehouseId, shelfLocationId: locationId }
					: line,
			),
		);
	};
	const toggleSameLocation = () => {
		const next = !useSameLocation;
		setUseSameLocation(next);
		if (!next) return;
		setLines((currentLines) => {
			const sharedLine = currentLines.find(
				(line) => line.warehouseId && line.shelfLocationId,
			);
			if (!sharedLine) return currentLines;
			return currentLines.map((line) => ({
				...line,
				warehouseId: sharedLine.warehouseId,
				shelfLocationId: sharedLine.shelfLocationId,
			}));
		});
	};
	const setLineDates = (
		index: number,
		patch: Partial<Pick<Line, "manufacturingDate" | "expiryDate">>,
	) => {
		setLines((current) =>
			current.map((line, i) =>
				useSameDates || i === index ? { ...line, ...patch } : line,
			),
		);
	};
	const toggleSameDates = () => {
		const next = !useSameDates;
		setUseSameDates(next);
		if (!next) return;
		setLines((currentLines) => {
			const sharedLine =
				currentLines.find(
					(line) => line.manufacturingDate && line.expiryDate,
				) || currentLines[0];
			if (!sharedLine) return currentLines;
			return currentLines.map((line) => ({
				...line,
				manufacturingDate: sharedLine.manufacturingDate,
				expiryDate: sharedLine.expiryDate,
			}));
		});
	};
	const addLine = () => {
		setLines((current) => {
			const sharedLine = useSameLocation
				? current.find((line) => line.warehouseId && line.shelfLocationId)
				: undefined;
			const sharedDates = useSameDates
				? current.find((line) => line.manufacturingDate && line.expiryDate) ||
					current[0]
				: undefined;
			return [
				...current,
				{
					...newLine(),
					warehouseId: sharedLine?.warehouseId || "",
					shelfLocationId: sharedLine?.shelfLocationId || "",
					manufacturingDate:
						sharedDates?.manufacturingDate || todayISO(),
					expiryDate: sharedDates?.expiryDate || "",
				},
			];
		});
	};
	const availableLocationCount = warehouses.reduce(
		(total, warehouse) =>
			total +
			(warehouse.racks || []).reduce(
				(rackTotal, rack) =>
					rackTotal +
					(rack.cells || []).filter((cell) => !cell.occupied).length,
				0,
			),
		0,
	);
	const hasEnoughLocations = useMemo(() => {
		const requestedByWarehouse = new Map<string, number>();
		for (const line of lines) {
			if (!line.warehouseId) continue;
			const quantity = Number(line.quantity);
			if (Number.isInteger(quantity) && quantity > 0) {
				requestedByWarehouse.set(
					line.warehouseId,
					(requestedByWarehouse.get(line.warehouseId) || 0) + quantity,
				);
			}
		}
		return [...requestedByWarehouse.entries()].every(([warehouseId, requested]) => {
			const warehouse = warehouses.find(
				(row) => String(row.id) === warehouseId,
			);
			const freeLocations = (warehouse?.racks || [])
				.flatMap((rack) => rack.cells || [])
				.filter((cell) => !cell.occupied).length;
			return requested <= freeLocations;
		});
	}, [lines, warehouses]);

	const canCreate = useMemo(
		() =>
			lines.length > 0 &&
			availableLocationCount > 0 &&
			hasEnoughLocations &&
			new Set(lines.map((line) => line.productId).filter(Boolean))
				.size === lines.filter((line) => line.productId).length &&
			lines.every((line) => {
				const product = products.find(
					(row) => String(row.id) === line.productId,
				);
				const warehouse = warehouses.find(
					(row) => String(row.id) === line.warehouseId,
				);
				const location = (warehouse?.racks || [])
					.flatMap((rack) => rack.cells || [])
					.find(
						(cell) =>
							String(cell.shelf_location_id) ===
							line.shelfLocationId,
					);
				return (
					line.productId &&
					getUom(product) !== "UOM not set" &&
					hasValidPackageQuantity(line.packageQuantity) &&
					hasValidAvgQuantity(line.avgStandardQuantity) &&
					line.manufacturingDate &&
					line.expiryDate &&
					line.expiryDate >= line.manufacturingDate &&
					line.warehouseId &&
					line.shelfLocationId &&
					location &&
					!location.occupied &&
					Number.isInteger(Number(line.quantity)) &&
					Number(line.quantity) > 0 &&
					Number(line.quantity) <= 1000
				);
			}),
		[
			lines,
			products,
			uoms,
			bagQuantities,
			availableLocationCount,
			hasEnoughLocations,
			warehouses,
			useSameLocation,
		],
	);

	const create = async (event: React.FormEvent) => {
		event.preventDefault();
		if (busy || !canCreate) return;
		setError("");
		setMessage("");
		setBusy(true);
		try {
			const result = await api.batches.createGroup({
				items: lines.map((line) => {
					const product = products.find(
						(row) => String(row.id) === line.productId,
					);
					return {
						product_id: line.productId,
						quantity: Number(line.quantity),
						package_quantity: Number(line.packageQuantity),
						avg_standard_quantity:
							line.avgStandardQuantity.trim() === ""
								? null
								: Number(line.avgStandardQuantity),
						uom: getUom(product),
						shelf_location_id: line.shelfLocationId,
						warehouse_id: line.warehouseId,
						manufacturing_date: line.manufacturingDate,
						expiry_date: line.expiryDate,
						unit_price: Number(product?.price || 0),
					};
				}),
				// The same key is reused for a retry of this exact submission, so
				// a double click or a network retry cannot create two batches.
				client_operation_id: operationIdRef.current,
			});
			operationIdRef.current = newOperationId();
			setMessage(
				result.duplicate
					? `Batch ${result.batch_number} was already created with ${result.total_quantity} unit${result.total_quantity === 1 ? "" : "s"}. It is waiting for QC review.`
					: `Created batch ${result.batch_number} with ${result.product_count} product${result.product_count === 1 ? "" : "s"} and ${result.total_quantity} unit${result.total_quantity === 1 ? "" : "s"}. It is now waiting for QC review. QR labels can be printed after QC passes.`,
			);
			setLines([newLine()]);
			setShowCreateForm(false);
			await reload();
		} catch (err: any) {
			setError(err.message || "Could not create the batch");
		} finally {
			setBusy(false);
		}
	};

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
				product_lines: new Map<string, any>(),
				quantity_total: 0,
				qr_count_total: 0,
			};
			const productKey = String(batch.product_id);
			const productLine = group.product_lines.get(productKey) || {
				...batch,
				product_name: batch.product_name || "Product",
				quantity: 0,
				locations: new Set<string>(),
			};
			productLine.quantity += Number(batch.quantity || 0);
			if (batch.location_code || batch.storage_location) {
				productLine.locations.add(
					String(batch.location_code || batch.storage_location),
				);
			}
			group.product_lines.set(productKey, productLine);
			group.quantity_total += Number(batch.quantity || 0);
			group.qr_count_total += Number(batch.qr_count || 0);
			groups.set(key, group);
		}
		return [...groups.values()].map((group) => ({
			...group,
			product_lines: [...group.product_lines.values()].map(
				(line: any) => ({
					...line,
					locations: [...line.locations],
				}),
			),
		}));
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
							Create Stock Batch
						</h1>
						<p className="mt-1 text-sm text-slate-500 sm:text-base">
							Add one or more products, then send the batch to
							QC for review. Stock becomes available only after
							QC passes it.
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
			<div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-medium text-sky-800">
				Batches created here are <strong>not stock yet</strong>. QC
				will review each batch and mark it Pass or Fail.
			</div>
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
							Batches sent to QC
						</h2>
						<p className="mt-1 text-sm font-medium text-slate-500">
							Track the review status of batches created by
							Dispatch.
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
								<th>Total bags</th>
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
															{line.package_quantity
																? `${line.package_quantity} ${line.uom} × `
																: `${line.uom} × `}
															{line.quantity}
														</span>
														<span className="text-xs text-slate-400">
															{line.warehouse_name ||
																"No godown"}
															{line.locations?.length
																? ` · ${line.locations.length} positions`
																: ""}
														</span>
													</div>
												),
											)}
										</div>
									</td>
									<td className="font-semibold">
										{batch.quantity_total.toLocaleString()}{" "}
										bags
									</td>
									<td>
										<span
											className={
												(batchStatusMeta[batch.status] || {
													label: batch.status,
													className: "badge badge-info",
												}).className
											}
										>
											{
												(batchStatusMeta[batch.status] || {
													label: batch.status,
												}).label
											}
										</span>
									</td>
									<td className="text-xs font-medium text-slate-500">
										{batch.created_at
											? formatDateTime(batch.created_at)
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
						className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-y-auto rounded-3xl bg-white shadow-2xl"
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
												Create a stock batch
											</h2>
											<p className="mt-1.5 max-w-xl text-sm text-slate-500 sm:text-base">
												Add products, set the package
												size and bag count, then choose
												a godown and MFD / expiry dates
												for each product. QC will review
												the batch before stock is added.
											</p>
											{/* <p className="mt-1 text-xs font-semibold text-slate-500">
												Initial QR labels print once.
												For missing or damaged labels,
												request an admin-approved
												reprint.
											</p> */}
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
							{/* toggle buttons for shared location and shared MFD/expiry dates */}
							<div className="flex w-fit flex-col gap-2 px-5 py-2 sm:ml-auto sm:mr-4 items-end">
								<div className="flex items-center gap-2.5">
									<span className="text-sm font-semibold text-slate-700">
										Same MFD &amp; EXP date ?
									</span>
									<button
										type="button"
										role="switch"
										aria-checked={useSameDates}
										aria-label="Use the same manufacturing and expiry date for all products"
										onClick={toggleSameDates}
										className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border-0 p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
											useSameDates
												? "bg-indigo-600"
												: "bg-slate-300"
										}`}
									>
										<span
											className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
												useSameDates
													? "translate-x-5"
													: "translate-x-0"
											}`}
										/>
									</button>
									{/* if button is turned on then it will show "yes" if not then "no" */}
									{useSameDates && (
										<span className="text-sm text-slate-500">Yes</span>
									)}
									{!useSameDates && (
										<span className="text-sm text-slate-500">No</span>
									)}
								</div>

								<div className="flex items-center gap-2.5">
									<span className="text-sm font-semibold text-slate-700">
										Same locations ?
									</span>
									<button
										type="button"
										role="switch"
										aria-checked={useSameLocation}
										aria-label="Use the same godown location for all products"
										onClick={toggleSameLocation}
										className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border-0 p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
											useSameLocation
												? "bg-indigo-600"
												: "bg-slate-300"
										}`}
									>
										<span
											className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
												useSameLocation
													? "translate-x-5"
													: "translate-x-0"
											}`}
										/>
									</button>
									{/* if button is turned on then it will show "yes" if not then "no" */}
									{useSameLocation && (
										<span className="text-sm text-slate-500">Yes</span>
									)}
									{!useSameLocation && (
										<span className="text-sm text-slate-500">No</span>
									)}
								</div>
								
							</div>

							<div className="space-y-1 px-5 py-4 sm:px-8 sm:py-5">
								<table className="block w-full text-left text-xs sm:table sm:table-fixed sm:text-sm">
									<colgroup className="hidden sm:table-column-group">
										<col className="w-[26%]" />
										<col className="w-[12%]" />
										<col className="w-[12%]" />
										<col className="w-[16%]" />
										<col className="w-[18%]" />
										<col className="w-[16%]" />
									</colgroup>
									<thead className="hidden bg-slate-50 sm:table-header-group">
										<tr className="border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-600">
											<th className="break-words border-b border-r border-slate-200 px-1.5 py-3 sm:px-2">
												Product
											</th>
											<th className="break-words border-b border-r border-slate-200 px-1.5 py-3 sm:px-2">
												QTY Per Unit
											</th>
											<th className="break-words border-b border-r border-slate-200 px-1.5 py-3 sm:px-2">
												Avg. qty
											</th>
											{/* <th className="break-words border-b border-r border-slate-200 px-1.5 py-3 sm:px-2">
												UOM
												</th> */}
											<th className="break-words border-b border-r border-slate-200 px-1.5 py-3 sm:px-2">
												Number of Units
											</th>
											<th className="break-words border-b border-r border-slate-200 px-1.5 py-3 sm:px-2">
												MFD &amp; Expiry
											</th>
											<th className="break-words border-b border-slate-200 px-1.5 py-3 sm:px-2">
												Storage Location
											</th>
										</tr>
									</thead>
									<tbody className="block sm:table-row-group">
										{lines.map((line, index) => {
											const product = products.find(
												(row) =>
													String(row.id) ===
													line.productId,
											);
											const lineLabels =
												Number(line.quantity) || 0;
											const positionsNeeded = lines
												.filter(
													(row) =>
														row.warehouseId ===
														line.warehouseId,
												)
												.reduce(
													(total, row) =>
														total +
														(Number(row.quantity) || 0),
													0,
												);
											const uom = product
												? getUom(product)
												: "UOM not set";
											const uomReady =
												uom !== "UOM not set";
											const rowBorderClass =
												index === lines.length - 1
													? "sm:border-b-0"
													: "sm:border-b sm:border-slate-200";
											return (
												<tr
													key={index}
													className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 p-3 last:mb-0 sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:p-0"
												>
													<td className={`col-span-2 block min-w-0 px-1 py-1 align-top font-medium text-slate-800 sm:table-cell sm:border-r sm:border-slate-200 sm:px-2 sm:py-3 ${rowBorderClass}`}>
														<span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
															Product
														</span>
														<div className="flex min-w-0 items-center gap-1">
															<ProductPicker
																products={products}
																value={line.productId}
																onChange={(productId) =>
																	updateLine(index, {
																		productId,
																		packageQuantity: getPackageDefault(
																			products.find((row) => String(row.id) === productId),
																		),
																	})
																}
															/>
															<button
																className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
																type="button"
																aria-label={`Remove product row ${index + 1}`}
																disabled={
																	lines.length ===
																	1
																}
																onClick={() =>
																	setLines(
																		(
																			current,
																		) =>
																			current.filter(
																				(
																					_,
																					i,
																				) =>
																					i !==
																					index,
																			),
																	)
																}
															>
																<Trash2
																	size={16}
																/>
															</button>
														</div>
														{product && (
															<p className="mt-1.5 font-mono text-[11px] font-semibold text-slate-400">
																SKU:{" "}
																<span className="text-slate-500">
																	{product.sku}
																</span>
															</p>
														)}
														{product &&
															getUom(product) ===
																"UOM not set" && (
																<p className="mt-1 text-xs font-semibold text-rose-600">
																	Set a UOM on
																	the product
																	first.
																</p>
															)}
													</td>

													{/* package qty */}
													<td className={`block min-w-0 px-1 py-1 align-top font-medium text-slate-800 sm:table-cell sm:border-r sm:border-slate-200 sm:px-2 sm:py-3 ${rowBorderClass}`}>
														<span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
															Package quantity
														</span>
														<div className="flex min-w-0 items-center gap-1">
															<input
																id={`package-quantity-${index}`}
																className="input h-10 min-w-0 flex-1 border-slate-200 bg-white px-1 text-center font-bold text-slate-900 sm:px-2"
																type="text"
																inputMode="decimal"
																placeholder="e.g. 50"
																value={
																	line.packageQuantity
																}
																required
																onChange={(
																	event,
																) =>
																	updateLine(
																		index,
																		{
																			packageQuantity:
																				sanitizeDecimalInput(
																					event
																						.target
																						.value,
																				),
																		},
																	)
																}
																aria-label={`Package quantity per bag for product ${index + 1}`}
															/>
															<span className="shrink-0 text-xs font-bold text-slate-500">
																{uomReady
																	? uom
																	: ""}
															</span>
														</div>
														{hasValidPackageQuantity(
															line.packageQuantity,
														) && (
															<p className="mt-1 text-[11px] font-medium text-slate-500">
																{line.quantity}{" "}
																bags ×{" "}
																{
																	line.packageQuantity
																}{" "}
																{uom} ={" "}
																{(
																	Number(
																		line.quantity,
																	) *
																	Number(
																		line.packageQuantity,
																	)
																).toLocaleString()}{" "}
																{uom}
															</p>
														)}
													</td>
													{/* avg qty */}
													<td className={`block min-w-0 px-1 py-1 align-top font-medium text-slate-800 sm:table-cell sm:border-r sm:border-slate-200 sm:px-2 sm:py-3 ${rowBorderClass}`}>
														<span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
															Avg. quantity
														</span>
														<div className="flex min-w-0 items-center gap-1">
															<input
																id={`avg-quantity-${index}`}
																className="input h-10 min-w-0 flex-1 border-slate-200 bg-white px-1 text-center font-bold text-slate-900 sm:px-2"
																type="text"
																inputMode="decimal"
																placeholder="Optional"
																value={
																	line.avgStandardQuantity
																}
																onChange={(
																	event,
																) =>
																	updateLine(
																		index,
																		{
																			avgStandardQuantity:
																				sanitizeDecimalInput(
																					event
																						.target
																						.value,
																				),
																		},
																	)
																}
																aria-label={`Average standard quantity for product ${index + 1}`}
															/>
															<span className="shrink-0 text-xs font-bold text-slate-500">
																{uomReady
																	? uom
																	: ""}
															</span>
														</div>
													</td>
													{/* UOM already displayed with avg qty and pkg qty */}
													{/* <td className="block min-w-0 px-1 py-1 align-top font-medium text-slate-800 sm:table-cell sm:border-r sm:border-slate-200 sm:px-2 sm:py-3">
														<span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
															UOM
														</span>
														<span
															className={`flex max-w-[7.5rem] shrink-0 items-center justify-center truncate border-l px-2.5 text-[11px] font-extrabold tracking-wide ${
																uomReady
																	? "border-emerald-200 bg-emerald-50 text-emerald-800"
																	: "border-slate-200 bg-slate-100 text-slate-400"
															}`}
															title={
																uomReady
																	? uom
																	: "UOM not set"
															}
														>
															{uomReady
																? uom
																: "UOM"}
														</span>
													</td> */}
													{/* bags */}
													<td className={`col-span-2 block min-w-0 px-1 py-1 align-top font-medium text-slate-800 sm:table-cell sm:border-r sm:border-slate-200 sm:px-2 sm:py-3 ${rowBorderClass}`}>
														<span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
															Bags to create
														</span>
														<div className="flex items-center gap-1.5">
															<button
																type="button"
																className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 sm:w-9"
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
																<Minus
																	size={14}
																/>
															</button>
															<input
																className="input h-10 min-w-0 flex-1 border-slate-200 bg-white px-1 text-center font-bold text-slate-900"
																type="text"
																inputMode="numeric"
																pattern="[0-9]*"
																value={
																	line.quantity
																}
																required
																onChange={(
																	event,
																) =>
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
																className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 sm:w-9"
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
																<Plus
																	size={14}
																/>
															</button>
														</div>
														<span className="text-[11px] font-medium text-slate-500">
															{lineLabels.toLocaleString()}{" "}
															QR{" "}
															{lineLabels === 1
																? "label"
																: "labels"}{" "}
															will be reserved for
															this line.
														</span>
													</td>
													{(!useSameDates || index === 0) && (
														<td
															rowSpan={
																useSameDates
																	? lines.length
																	: undefined
															}
															className={`col-span-2 block min-w-0 px-1 py-1 align-top font-medium text-slate-800 sm:table-cell sm:border-r sm:border-slate-200 sm:px-2 sm:py-3 ${
																useSameDates
																	? "sm:border-b-0"
																	: `sm:border-b sm:border-slate-200 ${
																			index ===
																			lines.length -
																				1
																				? "sm:border-b-0"
																				: ""
																		}`
															}`}
														>
															<span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
																{useSameDates
																	? "Shared MFD & expiry"
																	: "MFD & expiry"}
															</span>
															<div className="grid gap-1">
																<label className="flex items-center gap-1.5">
																	<span className="w-9 shrink-0 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
																		MFD
																	</span>
																	<IsoDateInput
																		className="input h-9 min-w-0 flex-1 cursor-pointer border-slate-200 bg-white px-1 text-xs font-semibold text-slate-900"
																		value={
																			line.manufacturingDate
																		}
																		max={
																			line.expiryDate ||
																			undefined
																		}
																		required
																		aria-label={`Manufacturing date for product ${index + 1}`}
																		onChange={(value) =>
																			setLineDates(
																				index,
																				{
																					manufacturingDate:
																						value,
																				},
																			)
																		}
																	/>
																</label>
																<label className="flex items-center gap-1.5">
																	<span className="w-9 shrink-0 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
																		EXP
																	</span>
																	<IsoDateInput
																		className="input h-9 min-w-0 flex-1 cursor-pointer border-slate-200 bg-white px-1 text-xs font-semibold text-slate-900"
																		value={
																			line.expiryDate
																		}
																		min={
																			line.manufacturingDate ||
																			undefined
																		}
																		required
																		aria-label={`Expiry date for product ${index + 1}`}
																		onChange={(value) =>
																			setLineDates(
																				index,
																				{
																					expiryDate:
																						value,
																				},
																			)
																		}
																	/>
																</label>
															</div>
														</td>
													)}
													{(!useSameLocation ||
														index === 0) && (
														<td
															rowSpan={
																useSameLocation
																	? lines.length
																	: undefined
															}
															className={`col-span-2 block min-w-0 px-1 py-1 align-top font-medium text-slate-800 sm:table-cell sm:px-2 sm:py-3 ${
																useSameLocation
																	? "sm:border-b-0"
																	: `sm:border-b sm:border-slate-200 ${
																			index ===
																			lines.length -
																				1
																				? "sm:border-b-0"
																				: ""
																		}`
															}`}
														>
															<span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
																{useSameLocation
																	? "Shared godown"
																	: "Godown"}
															</span>
															<GodownSelector
																warehouses={
																	warehouses
																}
																warehouseId={
																	line.warehouseId
																}
																value={
																	line.shelfLocationId
																}
																requiredQuantity={
																	positionsNeeded
																}
																onChange={(
																	warehouseId,
																	value,
																) =>
																	setLineLocation(
																		index,
																		warehouseId,
																		value,
																	)
																}
															/>
														</td>
													)}
												</tr>
											);
										})}
									</tbody>
								</table>
								{availableLocationCount === 0 && loaded && (
									<p className="text-sm text-rose-600">
										Add an active godown with available
										storage positions before creating a
										batch.
									</p>
								)}
								{availableLocationCount > 0 &&
									!hasEnoughLocations &&
									lines.some((line) => line.warehouseId) && (
										<p className="text-sm text-rose-600">
											The selected godown does not have
											enough empty positions for all bags.
											Each bag needs its own position.
										</p>
									)}
								<div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
									<button
										type="button"
										className="btn-secondary"
										onClick={addLine}
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
											will be reserved
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
												"Creating batch…"
											) : (
												<>
													<Send size={16} /> Create
													batch &amp; send to QC
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
