import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Boxes, Loader2, MapPin, Package, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";

type StoredBatch = {
	id: string | number;
	batch_number: string;
	product_name: string | null;
	product_sku: string | null;
	quantity: number;
	remaining_quantity?: number;
	uom: string | null;
	manufacturing_date?: string | null;
	expiry_date?: string | null;
	status?: string | null;
	product_details?: {
		description?: string | null;
		cas_number?: string | null;
		molecular_formula?: string | null;
		purity?: string | null;
		grade?: string | null;
		storage_conditions?: string | null;
		hazard_classification?: string | null;
		physical_state?: string | null;
		hsn_code?: string | null;
		manufacturer?: string | null;
	} | null;
};
type StorageCell = {
	row: number;
	column: number;
	cell_code: string;
	shelf_location_id: string;
	location_code: string;
	occupied: boolean;
	used_capacity: number;
	batches: StoredBatch[];
};
type StorageRackData = {
	id: string;
	rack_code: string;
	rows: number;
	rows_count?: number;
	columns: number;
	columns_count?: number;
	cells: StorageCell[];
	occupied_cells: number;
	total_cells: number;
};
type WarehouseRow = {
	id: string;
	name: string;
	capacity: number;
	occupied_capacity: number;
	racks: StorageRackData[];
};
function useStorageData() {
	const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const reload = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			setWarehouses(await api.storage.list());
		} catch (err: any) {
			setError(err.message || "Could not load storage locations.");
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void reload();
	}, [reload]);
	return { warehouses, loading, error, setError, message, setMessage };
}
function StoragePageFrame({
	children,
	error,
	setError,
	message,
	setMessage,
}: {
	children: React.ReactNode;
	error: string;
	setError: (value: string) => void;
	message: string;
	setMessage: (value: string) => void;
}) {
	return (
		<div className="relative min-h-[calc(100vh-8rem)] w-full overflow-hidden rounded-3xl bg-[#f9fafb] p-4 sm:p-6 lg:p-8">
			<div
				className="pointer-events-none fixed inset-0 z-0 ml-[251px]"
				style={{
					backgroundImage:
						"linear-gradient(to right, #d1d5db 1px, transparent 1px), linear-gradient(to bottom, #d1d5db 1px, transparent 1px)",
					backgroundSize: "32px 32px",
					WebkitMaskImage:
						"radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 70%)",
					maskImage:
						"radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 70%)",
				}}
			/>
			<div className="relative z-10 mx-auto max-w-7xl space-y-6">
				{error && (
					<div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
						<span>{error}</span>
						<button
							onClick={() => setError("")}
							aria-label="Dismiss error"
						>
							<X size={16} />
						</button>
					</div>
				)}
				{message && (
					<div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
						<span>{message}</span>
						<button
							onClick={() => setMessage("")}
							aria-label="Dismiss message"
						>
							<X size={16} />
						</button>
					</div>
				)}
				{children}
			</div>
		</div>
	);
}
function StorageLoading() {
	return (
		<div className="flex items-center justify-center rounded-2xl border border-white/70 bg-white/85 py-20 text-slate-500">
			<Loader2 className="mr-2 animate-spin" size={18} />
			Loading rack…
		</div>
	);
}
function Metric({
	icon,
	label,
	value,
	detail,
}: {
	icon: React.ReactNode;
	label: string;
	value: React.ReactNode;
	detail?: string;
}) {
	return (
		<div className="group rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md sm:p-5">
			<div className="flex items-center gap-4">
				<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 transition group-hover:bg-indigo-100">
					{icon}
				</span>
				<div className="min-w-0">
					<p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-500">
						{label}
					</p>
					<p className="mt-1 truncate text-2xl font-extrabold leading-none tabular-nums text-slate-950">
						{value}
					</p>
					{detail && (
						<p className="mt-0.5 text-xs font-medium text-slate-500">
							{detail}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
function rackCellAsset(
	cell: Pick<StorageCell, "row" | "column">,
	rows: number,
	columns: number,
): string {
	const left = cell.column === 1;
	const right = cell.column === columns;
	const top = cell.row === rows;
	const bottom = cell.row === 0;

	if (top) {
		if (columns === 1) return "RACK_MIDDLE.svg";
		if (left) return "RACK_TOP_LEFT.svg";
		if (right) return "RACK_TOP_RIGHT.svg";
		return "RACK_MIDDLE.svg";
	}
	if (bottom) {
		if (columns === 1) return "RACK_BOTTOM.svg";
		if (left) return "RACK_BOTTOM_LEFT.svg";
		if (right) return "RACK_BOTTOM_RIGHT.svg";
		return "RACK_BOTTOM.svg";
	}
	if (columns === 1) return "RACK_MIDDLE.svg";
	if (left) return "RACK_MIDDLE_LEFT.svg";
	if (right) return "RACK_MIDDLE_RIGHT.svg";
	return "RACK_MIDDLE.svg";
}

function rackCellAlignmentClass(
	asset: string,
	cell: Pick<StorageCell, "row">,
	rows: number,
) {
	if (asset === "RACK_TOP_LEFT.svg") return "ml-auto mt-auto";
	if (asset === "RACK_TOP_RIGHT.svg") return "mr-auto mt-auto";
	if (asset === "RACK_MIDDLE_LEFT.svg") return "ml-auto";
	if (asset === "RACK_MIDDLE_RIGHT.svg") return "mr-auto";
	if (asset === "RACK_BOTTOM_LEFT.svg") return "mb-auto ml-auto";
	if (asset === "RACK_BOTTOM.svg") return "mb-auto";
	if (asset === "RACK_BOTTOM_RIGHT.svg") return "mb-auto mr-auto";
	if (asset === "RACK_MIDDLE.svg" && cell.row === rows) return "mt-auto";
	return "";
}

function RackWall({
	rack,
	selectedCell,
	onSelectCell,
}: {
	rack: StorageRackData;
	selectedCell: StorageCell | null;
	onSelectCell: (cell: StorageCell) => void;
}) {
	const rows = Number(rack.rows || rack.rows_count || 0);
	const columns = Number(rack.columns || rack.columns_count || 0);
	const cellsTopToBottom = [...rack.cells].sort(
		(a, b) => b.row - a.row || a.column - b.column,
	);
	const detailPath = (cell: StorageCell) =>
		cell.cell_code +
		" · " +
		(cell.occupied
			? cell.batches
					.map((batch) => batch.product_name)
					.filter(Boolean)
					.join(", ")
			: "Empty position");

	const renderBaseCell = (column: number) => {
		const cell = { row: 0, column };
		const asset = rackCellAsset(cell, rows, columns);
		return (
			<div
				key={`${rack.id}-base-${column}`}
				className={`relative inline-flex shrink-0 ${rackCellAlignmentClass(asset, cell, rows)}`}
			>
				<img
					src={`/StorageAssets/${asset}`}
					alt=""
					draggable={false}
					onContextMenu={(event) => event.preventDefault()}
					className="pointer-events-none block select-none"
				/>
			</div>
		);
	};

	const renderPosition = (cell: StorageCell) => {
		const asset = rackCellAsset(cell, rows, columns);
		return (
			<button
				key={cell.cell_code}
				type="button"
				title={detailPath(cell)}
				aria-label={`View ${cell.location_code}${
					cell.occupied
						? `, occupied by ${cell.batches
								.map((batch) => batch.product_name)
								.filter(Boolean)
								.join(", ")}`
						: ", empty"
				}`}
				aria-pressed={selectedCell?.cell_code === cell.cell_code}
				onClick={() => onSelectCell(cell)}
				className={`relative inline-flex shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${rackCellAlignmentClass(asset, cell, rows)}`}
			>
				<img
					src={`/StorageAssets/${asset}`}
					alt=""
					draggable={false}
					onContextMenu={(event) => event.preventDefault()}
					className="pointer-events-none block select-none"
				/>
				<span
					title={cell.location_code}
					className={`pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2 rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-700 shadow-sm ${selectedCell?.cell_code === cell.cell_code ? "ring-1 ring-indigo-400" : ""}`}
				>
					S{cell.row}-P{cell.column}
				</span>
				{cell.occupied && (
					<img
						src="/StorageAssets/box.png"
						alt=""
						draggable={false}
						onContextMenu={(event) => event.preventDefault()}
						className={`pointer-events-none translate-1 absolute bottom-2 left-1/2 z-10 h-15 w-auto -translate-x-1/2 select-none ${cell.column === 1 ? "-translate-x-1/3" : ""} ${cell.column === columns ? "-translate-x-2/3" : ""}`}
					/>
				)}
			</button>
		);
	};

	return (
		<section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-sm">
			<header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-indigo-600">
						Rack layout
					</p>
					<h2 className="mt-1 text-lg font-extrabold text-slate-900">
						Storage positions
					</h2>
					<p className="mt-0.5 text-sm text-slate-500">
						Select any labeled position to inspect its stored
						products.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-600">
					<span className="rounded-full bg-slate-100 px-3 py-1.5">
						{rows} shelves · {columns} positions per shelf
					</span>
					<span className="flex items-center gap-1.5">
						<span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
						Occupied
					</span>
					<span className="flex items-center gap-1.5">
						<span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
						Empty
					</span>
				</div>
			</header>
			<div className="overflow-x-auto p-4 sm:p-6">
				<div className="mx-auto w-max min-w-max rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 sm:p-6">
					<div className="mb-4 flex justify-center">
						<span className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-extrabold tracking-wide text-white shadow-sm">
							{rack.rack_code}
						</span>
					</div>
					{Array.from({ length: rows + 1 }, (_, index) => {
						const row = rows - index;
						return (
							<div
								key={`${rack.id}-row-${row}`}
								className="flex items-start"
							>
								{row === 0
									? Array.from(
											{ length: columns },
											(_, columnIndex) =>
												renderBaseCell(columnIndex + 1),
										)
									: cellsTopToBottom
											.filter((cell) => cell.row === row)
											.map(renderPosition)}
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
function CellDetails({ cell }: { cell: StorageCell | null }) {
	if (!cell) {
		return (
			<aside className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 text-center shadow-sm">
				<p className="font-bold text-slate-800">
					Select a rack position
				</p>
				<p className="mt-1 text-sm text-slate-500">
					Position details will appear here.
				</p>
			</aside>
		);
	}
	const formatDate = (value?: string | null) =>
		value ? new Date(value).toLocaleDateString() : null;
	const formatValue = (value: unknown) =>
		value === null || value === undefined || value === ""
			? null
			: String(value);
	const detailLabel = (label: string, value: unknown) => {
		const displayValue = formatValue(value);
		return displayValue ? (
			<div
				key={label}
				className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5"
			>
				<p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
					{label}
				</p>
				<p className="mt-1 break-words text-sm font-semibold text-slate-800">
					{displayValue}
				</p>
			</div>
		) : null;
	};
	return (
		<aside className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-sm xl:sticky xl:top-6">
			<div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-br from-indigo-50/80 to-white px-5 py-5 sm:px-6">
				<div>
					<p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-indigo-600">
						Position details
					</p>
					<h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">
						{cell.cell_code}
					</h2>
					<p className="mt-1 break-all font-mono text-[11px] text-slate-500">
						{cell.location_code}
					</p>
				</div>
				<span
					className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold ${cell.occupied ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}
				>
					{cell.occupied ? "Occupied" : "Empty"}
				</span>
			</div>
			<div className="max-h-[calc(100vh-20rem)] space-y-5 overflow-y-auto p-4 sm:p-5">
				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
					{detailLabel("Shelf", `S${cell.row}`)}
					{detailLabel("Position", `P${cell.column}`)}
					{detailLabel(
						"Stored quantity",
						`${cell.used_capacity} units`,
					)}
					{detailLabel("Position code", cell.location_code)}
				</div>
				{cell.batches.length ? (
					<div className="space-y-4">
						<div className="flex items-end justify-between gap-3">
							<div>
								<p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-indigo-600">
									Stored inventory
								</p>
								<h3 className="mt-1 text-lg font-extrabold text-slate-900">
									Products in this position
								</h3>
							</div>
							<span className="text-xs font-bold text-slate-500">
								{cell.batches.length}{" "}
								{cell.batches.length === 1
									? "product lot"
									: "product lots"}
							</span>
						</div>
						{cell.batches.map((batch) => {
							const details = batch.product_details;
							const specifications: Array<[string, unknown]> = [
								["Description", details?.description],
								["Grade", details?.grade],
								["Physical state", details?.physical_state],
								["CAS number", details?.cas_number],
								[
									"Molecular formula",
									details?.molecular_formula,
								],
								["Purity", details?.purity],
								["Manufacturer", details?.manufacturer],
								[
									"Storage conditions",
									details?.storage_conditions,
								],
								[
									"Hazard classification",
									details?.hazard_classification,
								],
								["HSN code", details?.hsn_code],
								[
									"Manufactured",
									formatDate(batch.manufacturing_date),
								],
								["Expires", formatDate(batch.expiry_date)],
							].filter(([, value]) => formatValue(value));
							return (
								<article
									key={batch.id}
									className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
								>
									<div className="flex flex-col gap-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50/80 to-white p-4">
										<div className="min-w-0">
											<h4 className="text-lg font-extrabold text-slate-950">
												{batch.product_name ||
													"Unnamed product"}
											</h4>
											<p className="mt-1 break-all font-mono text-xs text-slate-500">
												{batch.product_sku || "No SKU"}{" "}
												· Lot {batch.batch_number}
											</p>
											{batch.status && (
												<span className="mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700">
													{batch.status.replaceAll(
														"_",
														" ",
													)}
												</span>
											)}
										</div>
										<div className="grid grid-cols-2 gap-2">
											<div className="rounded-xl bg-white px-3 py-2 shadow-sm">
												<p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
													Available
												</p>
												<p className="mt-1 text-lg font-extrabold tabular-nums text-indigo-700">
													{batch.remaining_quantity ??
														batch.quantity}{" "}
													<span className="text-xs">
														x {batch.uom || "units"}
													</span>
												</p>
											</div>
											<div className="rounded-xl bg-white px-3 py-2 shadow-sm">
												<p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
													Original lot
												</p>
												<p className="mt-1 text-lg font-extrabold tabular-nums text-slate-800">
													{batch.quantity}{" "}
													<span className="text-xs">
														x {batch.uom || "units"}
													</span>
												</p>
											</div>
										</div>
									</div>
									{specifications.length > 0 && (
										<div className="grid gap-2 p-4 sm:grid-cols-2">
											{specifications.map(
												([label, value]) =>
													detailLabel(label, value),
											)}
										</div>
									)}
								</article>
							);
						})}
					</div>
				) : (
					<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-10 text-center">
						<span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
							<Package size={21} />
						</span>
						<p className="mt-3 font-bold text-slate-800">
							This position is empty
						</p>
						<p className="mt-1 text-sm text-slate-500">
							No inventory is currently assigned to this storage
							location.
						</p>
					</div>
				)}
			</div>
		</aside>
	);
}

export default function StorageRack() {
	const { warehouseId = "", rackId = "" } = useParams();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { user } = useAuth();
	const canManage = user?.role === "ADMIN" || user?.role === "QC";
	const { warehouses, loading, error, setError, message, setMessage } =
		useStorageData();
	const [selectedCell, setSelectedCell] = useState<StorageCell | null>(null);
	const warehouse = warehouses.find((row) => String(row.id) === warehouseId);
	const rack = warehouse?.racks.find((row) => String(row.id) === rackId);
	useEffect(() => {
		if (!rack) return;
		const firstTopPosition =
			[...rack.cells].sort(
				(a, b) => b.row - a.row || a.column - b.column,
			)[0] || null;
		const requestedLocation = searchParams.get("location");
		const requestedCell = requestedLocation
			? rack.cells.find(
					(cell) =>
						cell.location_code === requestedLocation ||
						cell.cell_code === requestedLocation,
				)
			: null;
		setSelectedCell(
			(current) =>
				requestedCell ||
				(current
					? rack.cells.find(
							(cell) => cell.cell_code === current.cell_code,
						) || firstTopPosition
					: firstTopPosition),
		);
	}, [rack, searchParams]);
	const occupied = rack?.occupied_cells || 0;
	const total = rack?.total_cells || 0;
	const removeRack = async () => {
		if (
			!warehouse ||
			!rack ||
			!window.confirm(`Remove ${rack.rack_code}? This cannot be undone.`)
		)
			return;
		try {
			await api.storage.removeRack(warehouse.id, rack.id);
			setMessage(`${rack.rack_code} removed.`);
			navigate(`/storage/${encodeURIComponent(warehouse.id)}`, {
				replace: true,
			});
		} catch (err: any) {
			setError(err.message || "Could not remove this rack.");
		}
	};

	return (
		<StoragePageFrame
			error={error}
			setError={setError}
			message={message}
			setMessage={setMessage}
		>
			{loading && !warehouse ? (
				<StorageLoading />
			) : !warehouse || !rack ? (
				<section className="rounded-2xl border border-dashed border-slate-300 bg-white/80 px-5 py-16 text-center">
					<h1 className="text-xl font-bold text-slate-800">
						Rack not found
					</h1>
					<p className="mt-2 text-sm text-slate-500">
						This rack may have been removed or is no longer
						available.
					</p>
					<button
						className="btn-primary mt-5"
						onClick={() =>
							navigate(
								warehouse
									? `/storage/${encodeURIComponent(warehouse.id)}`
									: "/storage",
							)
						}
					>
						<ArrowLeft size={15} />
						{warehouse
							? " Back to location"
							: " All storage locations"}
					</button>
				</section>
			) : (
				<>
					<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<button
								className="mb-2 inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-brand-700"
								onClick={() =>
									navigate(
										`/storage/${encodeURIComponent(warehouse.id)}`,
									)
								}
							>
								<ArrowLeft size={14} />
								{warehouse.name}
							</button>
							<div className="flex items-center gap-3">
								<h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
									Rack {rack.rack_code}
								</h1>
								<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-extrabold text-emerald-700">
									<span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
									Active
								</span>
							</div>
							<p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
								<MapPin size={14} />
								{warehouse.name} ·{" "}
								{rack.rows || rack.rows_count} shelves ·{" "}
								{rack.columns || rack.columns_count} positions
								per shelf
							</p>
						</div>
						{canManage && (
							<button
								className="btn-secondary text-rose-600"
								onClick={() => void removeRack()}
							>
								Remove rack
							</button>
						)}
					</header>
					<section className="grid gap-3 sm:grid-cols-3">
						<Metric
							icon={<Boxes size={20} />}
							label="Shelves"
							value={rack.rows || rack.rows_count || 0}
						/>
						<Metric
							icon={<Package size={20} />}
							label="Occupied positions"
							value={`${occupied} / ${total}`}
							detail={
								total
									? `${Math.round((occupied / total) * 100)}% rack utilization`
									: "No positions"
							}
						/>
						<Metric
							icon={<MapPin size={20} />}
							label="Available positions"
							value={Math.max(0, total - occupied)}
						/>
					</section>
					<div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
						<RackWall
							rack={rack}
							selectedCell={selectedCell}
							onSelectCell={setSelectedCell}
						/>
						<CellDetails cell={selectedCell} />
					</div>
				</>
			)}
		</StoragePageFrame>
	);
}
