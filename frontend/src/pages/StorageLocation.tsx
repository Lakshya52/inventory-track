import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
	ArrowLeft,
	Boxes,
	Check,
	Loader2,
	Package,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type StorageCell = {
	row: number;
	column: number;
	cell_code: string;
	shelf_location_id: string;
	location_code: string;
	occupied: boolean;
	used_capacity: number;
	batches: any[];
};
type StorageRack = {
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
	racks: StorageRack[];
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
	return {
		warehouses,
		loading,
		error,
		setError,
		message,
		setMessage,
		reload,
	};
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
			Loading storage…
		</div>
	);
}
function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<label className="block space-y-1.5">
			<span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
				{label}
			</span>
			{children}
		</label>
	);
}
function Dialog({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: React.ReactNode;
}) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[3px]"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl sm:p-7"
			>
				<div className="mb-5 flex items-start justify-between gap-4">
					<div>
						<p className="text-xs font-extrabold uppercase tracking-wider text-brand-600">
							Storage setup
						</p>
						<h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
							{title}
						</h2>
					</div>
					<button
						className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
						onClick={onClose}
						aria-label="Close dialog"
					>
						<X size={18} />
					</button>
				</div>
				{children}
			</div>
		</div>
	);
}
function RackForm({
	warehouse,
	initialRack,
	isEditing,
	saving,
	onCancel,
	onSubmit,
}: {
	warehouse: string;
	initialRack?: StorageRack | null;
	isEditing: boolean;
	saving: boolean;
	onCancel: () => void;
	onSubmit: (
		event: FormEvent<HTMLFormElement>,
		values: { name: string; rows: string; columns: string; bulk: boolean; count: string; startNumber: string },
	) => Promise<void>;
}) {
	const [values, setValues] = useState(() => ({
		name: initialRack?.rack_code || "",
		rows: String(initialRack?.rows || initialRack?.rows_count || 4),
		columns: String(initialRack?.columns || initialRack?.columns_count || 4),
		bulk: false,
		count: "3",
		startNumber: "1",
	}));
	const bulk = !isEditing && values.bulk;
	const count = Math.max(1, Math.min(50, Number(values.count) || 1));
	const startNumber = Math.max(1, Number(values.startNumber) || 1);
	const padLength = String(startNumber + count - 1).length;
	const firstName = `${values.name.trim()}${String(startNumber).padStart(padLength, "0")}`;
	const lastName = `${values.name.trim()}${String(startNumber + count - 1).padStart(padLength, "0")}`;
	return (
		<Dialog title={`${isEditing ? "Edit rack" : "Add rack"} · ${warehouse}`} onClose={onCancel}>
			<form
				onSubmit={(event) => void onSubmit(event, values)}
				className="space-y-4"
			>
				{!isEditing && <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
					<span><span className="block text-sm font-bold text-slate-800">Create multiple racks</span><span className="text-xs text-slate-500">Use one name pattern and dimensions for this location.</span></span>
					<input type="checkbox" checked={values.bulk} onChange={(event) => setValues((current) => ({ ...current, bulk: event.target.checked }))} className="h-4 w-4 accent-indigo-600" />
				</label>}
				<Field label={bulk ? "Rack name prefix" : "Rack name"}>
					<input
						className="input"
						value={values.name}
						onChange={(event) =>
							setValues((current) => ({
								...current,
								name: event.target.value,
							}))
						}
						placeholder={bulk ? "A" : "A1, Rack 01"}
						maxLength={120}
						required
						autoFocus
					/>
				</Field>
				{bulk && <div className="grid grid-cols-2 gap-3">
					<Field label="Number of racks">
						<input className="input" type="number" min="1" max="50" value={values.count} onChange={(event) => setValues((current) => ({ ...current, count: event.target.value }))} required />
					</Field>
					<Field label="Starting number">
						<input className="input" type="number" min="1" max="9999" value={values.startNumber} onChange={(event) => setValues((current) => ({ ...current, startNumber: event.target.value }))} required />
					</Field>
				</div>}
				<div className="grid grid-cols-2 gap-3">
					<Field label="Rows">
						<input
							className="input"
							type="number"
							min="1"
							max="30"
							value={values.rows}
							onChange={(event) =>
								setValues((current) => ({
									...current,
									rows: event.target.value,
								}))
							}
							required
						/>
					</Field>
					<Field label="Columns">
						<input
							className="input"
							type="number"
							min="1"
							max="30"
							value={values.columns}
							onChange={(event) =>
								setValues((current) => ({
									...current,
									columns: event.target.value,
								}))
							}
							required
						/>
					</Field>
				</div>
				<div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
					<strong>{(Number(values.rows) || 0) * (Number(values.columns) || 0) * (bulk ? count : 1)} shelf positions</strong> will be generated for QC’s location selector.
					{bulk && <span className="mt-1 block text-xs">Rack names: {firstName} through {lastName}</span>}
				</div>
				<p className="text-xs text-slate-500">
					Maximum 300 positions per rack.
				</p>
				<div className="flex justify-end gap-2 pt-2">
					<button
						type="button"
						className="btn-secondary"
						onClick={onCancel}
					>
						Cancel
					</button>
					<button className="btn-primary" disabled={saving}>
						{saving ? (
							<Loader2 size={15} className="animate-spin" />
						) : (
							<Check size={15} />
						)}{" "}
						{isEditing ? "Save rack" : bulk ? `Create ${count} racks` : "Create rack"}
					</button>
				</div>
			</form>
		</Dialog>
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

function totalRackPositions(warehouse: WarehouseRow) {
	return warehouse.racks.reduce((sum, rack) => sum + rack.total_cells, 0);
}
function totalOccupiedPositions(warehouse: WarehouseRow) {
	return warehouse.racks.reduce((sum, rack) => sum + rack.occupied_cells, 0);
}

export default function StorageLocation() {
	const { warehouseId = "" } = useParams();
	const navigate = useNavigate();
	const { user } = useAuth();
	const canManage = user?.role === "ADMIN" || user?.role === "QC";
	const {
		warehouses,
		loading,
		error,
		setError,
		message,
		setMessage,
		reload,
	} = useStorageData();
	const [search, setSearch] = useState("");
	const [saving, setSaving] = useState(false);
	const [rackDialog, setRackDialog] = useState(false);
	const [editingRack, setEditingRack] = useState<StorageRack | null>(null);
	const [rackToDelete, setRackToDelete] = useState<StorageRack | null>(null);
	const [deleteError, setDeleteError] = useState("");
	const [deletingRackId, setDeletingRackId] = useState<string | null>(null);
	const debouncedSearch = useDebouncedValue(search, 250);
	const warehouse = warehouses.find((row) => String(row.id) === warehouseId);
	const racks = useMemo(
		() =>
			warehouse?.racks.filter(
				(rack) =>
					!debouncedSearch ||
					`${rack.rack_code} ${rack.cells.flatMap((cell) => cell.batches.map((batch) => batch.product_name)).join(" ")}`
						.toLowerCase()
						.includes(debouncedSearch.toLowerCase()),
			) || [],
		[warehouse, debouncedSearch],
	);
	const occupied = warehouse ? totalOccupiedPositions(warehouse) : 0;
	const positions = warehouse ? totalRackPositions(warehouse) : 0;
	const occupancy = positions ? Math.round((occupied / positions) * 100) : 0;

	const saveRack = async (
		event: FormEvent<HTMLFormElement>,
		values: { name: string; rows: string; columns: string; bulk: boolean; count: string; startNumber: string },
	) => {
		event.preventDefault();
		if (!warehouse) return;
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const dimensions = { rows: Number(values.rows), columns: Number(values.columns) };
			if (!dimensions.rows || !dimensions.columns || dimensions.rows * dimensions.columns > 300) {
				throw new Error("Use rack dimensions that create between 1 and 300 storage positions.");
			}
			if (editingRack) {
				const saved = await api.storage.updateRack(warehouse.id, editingRack.id, { ...dimensions, name: values.name.trim() });
				await reload();
				setMessage(`${saved.rack_code} updated with ${saved.cells?.length ?? dimensions.rows * dimensions.columns} labeled storage positions.`);
			} else if (values.bulk) {
				const count = Number(values.count);
				const start = Number(values.startNumber);
				if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("Choose between 1 and 50 racks.");
				if (!Number.isInteger(start) || start < 1 || start > 9999) throw new Error("Starting number must be between 1 and 9999.");
				const padLength = String(start + count - 1).length;
				const names = Array.from({ length: count }, (_, index) => `${values.name.trim()}${String(start + index).padStart(padLength, "0")}`);
				const existing = new Set(warehouse.racks.map((rack) => rack.rack_code.toLowerCase()));
				const duplicate = names.find((name) => existing.has(name.toLowerCase()));
				if (!values.name.trim() || duplicate) throw new Error(duplicate ? `Rack ${duplicate} already exists in this location.` : "Enter a rack name prefix.");
				let created = 0;
				try {
					for (const name of names) {
						await api.storage.createRack(warehouse.id, { ...dimensions, name });
						created += 1;
					}
				} catch (err: any) {
					if (created > 0) {
						await reload();
						setRackDialog(false);
						setEditingRack(null);
						setMessage(`Created ${created} of ${count} racks before an error. ${err.message || "Please review this location before retrying."}`);
						return;
					}
					throw err;
				}
				await reload();
				setMessage(`Created ${created} racks (${created * dimensions.rows * dimensions.columns} labeled storage positions).`);
			} else {
				const saved = await api.storage.createRack(warehouse.id, { ...dimensions, name: values.name.trim() });
				await reload();
				setMessage(`${saved.rack_code} created with ${saved.cells?.length ?? dimensions.rows * dimensions.columns} labeled storage positions.`);
			}
			setRackDialog(false);
			setEditingRack(null);
		} catch (err: any) {
			setError(err.message || `Could not ${editingRack ? "update" : "create"} this rack.`);
		} finally {
			setSaving(false);
		}
	};
	const removeRack = async (rack: StorageRack) => {
		if (!warehouse) return;
		setDeletingRackId(String(rack.id));
		setDeleteError("");
		try {
			await api.storage.removeRack(warehouse.id, rack.id);
			await reload();
			setRackToDelete(null);
			setMessage(`${rack.rack_code} removed.`);
		} catch (err: any) {
			setDeleteError(err.message || "Could not remove rack.");
		} finally {
			setDeletingRackId(null);
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
			) : !warehouse ? (
				<section className="rounded-2xl border border-dashed border-slate-300 bg-white/80 px-5 py-16 text-center">
					<h1 className="text-xl font-bold text-slate-800">
						Storage location not found
					</h1>
					<p className="mt-2 text-sm text-slate-500">
						It may have been removed or you may not have access to
						it.
					</p>
					<button
						className="btn-primary mt-5"
						onClick={() => navigate("/storage")}
					>
						<ArrowLeft size={15} /> All storage locations
					</button>
				</section>
			) : (
				<>
					<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
						<div className="flex items-center gap-3">
							<div>
								<button
									className="mb-1 inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-brand-700"
									onClick={() => navigate("/storage")}
								>
									<ArrowLeft size={14} /> All storage
									locations
								</button>
								<h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
									{warehouse.name}
								</h1>
							</div>
							{/* <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-extrabold text-emerald-700">
								<span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
								Live
							</span> */}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<button
								className="btn-secondary rounded-full"
								onClick={() => void reload()}
								disabled={loading}
							>
								<RefreshCw
									size={15}
									className={loading ? "animate-spin" : ""}
								/>
								{/* Refresh */}
							</button>
							<label className="relative min-w-[210px] flex-1 sm:w-64">
								<Search
									size={16}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
								/>
								<input
									className="input h-10 rounded-full border-slate-200 bg-white/80 pl-9"
									placeholder="Search rack, product…"
									value={search}
									onChange={(event) =>
										setSearch(event.target.value)
									}
								/>
							</label>
							{canManage && (
								<button
									type="button"
									className="btn-primary rounded-full"
									onClick={() => { setEditingRack(null); setRackDialog(true); }}
								>
									<Plus size={16} /> Add rack
								</button>
							)}
						</div>
					</header>
					<section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
						<div className="flex flex-wrap items-center divide-y divide-slate-200 rounded-2xl border border-slate-200/80 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-sm sm:flex-nowrap sm:divide-x sm:divide-y-0 sm:px-5">
							<div className="flex min-w-[145px] flex-1 items-center gap-3 py-2 sm:py-1">
								<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
									<Boxes size={22} />
								</span>
								<div>
									<p className="text-xs font-semibold text-slate-500">
										Total racks
									</p>
									<p className="text-2xl font-extrabold leading-tight text-slate-900">
										{warehouse.racks.length}
									</p>
								</div>
							</div>
							<div className="flex min-w-[235px] flex-[1.4] items-center gap-3 py-2 sm:pl-5 sm:py-1">
								<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
									<Package size={22} />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-end justify-between gap-3">
										<div>
											<p className="text-xs font-semibold text-slate-500">
												Occupied positions
											</p>
											<p className="text-2xl font-extrabold leading-tight text-slate-900">
												{occupied}{" "}
												<span className="text-slate-400">
													/
												</span>{" "}
												{positions}
											</p>
										</div>
										<span className="text-xs font-extrabold text-slate-500">
											{occupancy}%
										</span>
									</div>
									<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
										<div
											className="h-full rounded-full bg-blue-500 transition-all"
											style={{ width: `${occupancy}%` }}
										/>
									</div>
								</div>
							</div>
						</div>
						{/* <div className="flex min-w-[195px] items-center justify-center gap-4 rounded-2xl border border-slate-200/80 bg-white/75 px-5 py-3 shadow-sm">
							<span className="flex items-center gap-2 text-sm font-semibold text-slate-600">
								<span className="h-3 w-3 rounded-full bg-blue-500" />
								Occupied
							</span>
							<span className="flex items-center gap-2 text-sm font-semibold text-slate-600">
								<span className="h-3 w-3 rounded-full bg-slate-300" />
								Empty
							</span>
						</div> */}
					</section>
					{/* <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-3 shadow-sm backdrop-blur-sm">
						<span className="rounded-full bg-blue-600 px-5 py-2 text-sm font-extrabold text-white shadow-sm">
							All racks
						</span>
						{warehouse.racks.map((rack) => (
							<button
								key={rack.id}
								className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-extrabold text-slate-700 hover:border-blue-300 hover:bg-blue-50"
								onClick={() =>
									navigate(
										`/storage/${encodeURIComponent(warehouse.id)}/racks/${encodeURIComponent(rack.id)}`,
									)
								}
							>
								{rack.rack_code}
							</button>
						))}
					</div> */}
					{warehouse.racks.length === 0 ? (
						<div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 px-5 py-16 text-center">
							<Boxes
								size={34}
								className="mx-auto text-slate-300"
							/>
							<h2 className="mt-3 text-lg font-bold text-slate-800">
								No racks in this location
							</h2>
							<p className="mt-1 text-sm text-slate-500">
								Add a rack and define its rows and columns to
								generate labeled positions.
							</p>
							{canManage && (
								<button
									type="button"
									className="btn-primary mt-5"
									onClick={() => { setEditingRack(null); setRackDialog(true); }}
								>
									<Plus size={15} /> Create first rack
								</button>
							)}
						</div>
					) : (
						// this is the location we need to edit for the visuals of the racks and cells

						// multiple racks containing div
						<div className="flex flex-wrap items-start gap-6">
							{/* single rack here */}
							{racks.map((rack) => {
								const rowCount = Number(
									rack.rows ||
									rack.rows_count ||
									Math.max(...rack.cells.map((cell) => cell.row), 0),
								);
								const columnCount = Number(
									rack.columns ||
									rack.columns_count ||
									Math.max(...rack.cells.map((cell) => cell.column), 0),
								);
								return (
									<article
										key={rack.id}
										className="group/rack relative inline-flex flex-col items-center rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md"
									>
										{canManage && (
										<div className="pointer-events-auto absolute right-3 top-3 z-30 flex items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm">
												<button
													type="button"
													title={`Edit ${rack.rack_code}`}
													aria-label={`Edit ${rack.rack_code}`}
													className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
													onClick={(event) => {
														event.stopPropagation();
														setEditingRack(rack);
														setRackDialog(true);
													}}
												>
													<Pencil size={17} />
												</button>
												<button
													type="button"
													title={`Delete ${rack.rack_code}`}
													aria-label={`Delete ${rack.rack_code}`}
													disabled={deletingRackId === String(rack.id)}
													className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-wait disabled:opacity-50"
													onClick={(event) => {
														event.stopPropagation();
														setDeleteError("");
														setRackToDelete(rack);
													}}
												>
													{deletingRackId === String(rack.id) ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
												</button>
											</div>
										)}

										<button
											type="button"
											className="group/rack-view flex w-full cursor-pointer flex-col items-center rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-4"
											title={`View ${rack.rack_code} storage positions`}
											onClick={() =>
												navigate(
													`/storage/${encodeURIComponent(warehouse.id)}/racks/${encodeURIComponent(rack.id)}`,
												)
											}
											onContextMenu={(event) => event.preventDefault()}
										>
											<span className="mb-4 rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-extrabold tracking-wide text-white shadow-sm transition group-hover/rack-view:bg-blue-700">
												{rack.rack_code}
											</span>
											<div>
												{Array.from({ length: rowCount + 1 }, (_, index) => {
													const row = rowCount - index;
													return (
														<div
															key={`${rack.id}-row-${row}`}
															className="flex items-start"
														>
															{row === 0
																? Array.from({ length: columnCount }, (_, columnIndex) => {
																	const cell = { row: 0, column: columnIndex + 1 };
																	const asset = rackCellAsset(cell, rowCount, columnCount);
																	return (
																		<div
																			key={`${rack.id}-base-${cell.column}`}
																			className={`relative inline-flex shrink-0 ${rackCellAlignmentClass(
																				asset,
																				cell,
																				rowCount,
																			)}`}
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
																})
																: rack.cells
																	.filter((cell) => cell.row === row)
																	.sort((a, b) => a.column - b.column)
																	.map((cell) => {
																		const asset = rackCellAsset(cell, rowCount, columnCount);
																		return (
																			<div
																				key={cell.cell_code}
																				className={`relative inline-flex shrink-0 ${rackCellAlignmentClass(
																					asset,
																					cell,
																					rowCount,
																				)}`}
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
																	className="pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2 rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-700 shadow-sm"
																				>
																					S{cell.row}-P{cell.column}
																				</span>
																				{cell.occupied && (
																					<img
																						src="/StorageAssets/box.png"
																						alt=""
																						draggable={false}
																						onContextMenu={(event) => event.preventDefault()}
																						className={`pointer-events-none translate-1 absolute bottom-2 left-1/2 z-10 h-15 w-auto -translate-x-1/2 select-none ${cell.column === 1 ? "-translate-x-1/3" : ""} ${cell.column === columnCount ? "-translate-x-2/3" : ""}`}
																					/>
																				)}
														</div>
														);
												})}
										</div>
									);
							})}
							</div>
						</button>
					</article>
				);
			})}
		</div>
					)}
					{rackDialog && canManage && (
						<RackForm
							key={editingRack?.id ?? "new-rack"}
							warehouse={warehouse.name}
							initialRack={editingRack}
							isEditing={Boolean(editingRack)}
							saving={saving}
							onCancel={() => { setRackDialog(false); setEditingRack(null); }}
							onSubmit={saveRack}
						/>
					)}
					{rackToDelete && canManage && (
						<Dialog
							title={`Delete ${rackToDelete.rack_code}?`}
							onClose={() => { if (!deletingRackId) setRackToDelete(null); }}
						>
							<div className="space-y-4">
								<p className="text-sm leading-6 text-slate-600">
									This removes the rack and its empty storage locations. A rack that still contains stock cannot be deleted.
								</p>
								{deleteError && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{deleteError}</p>}
								<div className="flex justify-end gap-2">
									<button type="button" className="btn-secondary" disabled={Boolean(deletingRackId)} onClick={() => setRackToDelete(null)}>Cancel</button>
									<button type="button" className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60" disabled={Boolean(deletingRackId)} onClick={() => void removeRack(rackToDelete)}>
										{deletingRackId ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
										{deletingRackId ? "Deleting…" : "Delete rack"}
									</button>
								</div>
							</div>
						</Dialog>
					)}
				</>
			)}
		</StoragePageFrame>
	);
}
