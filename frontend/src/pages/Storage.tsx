import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	Boxes,
	Building2,
	Check,
	ChevronRight,
	Loader2,
	MapPin,
	Package,
	Plus,
	RefreshCw,
	Search,
	Trash2,
	Warehouse,
	X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { Division, EntityId } from "../types";

type StorageRack = {
	id: string;
	rack_code: string;
	total_cells: number;
	occupied_cells: number;
};
type WarehouseRow = {
	id: string;
	name: string;
	capacity: number;
	occupied_capacity: number;
	division_id?: EntityId | null;
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

// function StoragePageFrame({
// 	children,
// 	error,
// 	setError,
// 	message,
// 	setMessage,
// }: {
// 	children: React.ReactNode;
// 	error: string;
// 	setError: (value: string) => void;
// 	message: string;
// 	setMessage: (value: string) => void;
// }) {
// 	return (
// 		<div className="relative min-h-[calc(100vh-8rem)] w-full overflow-hidden rounded-3xl bg-[#f9fafb] p-4 sm:p-6 lg:p-8">
// 			<div
// 				className="pointer-events-none fixed inset-0 z-0 ml-[251px]"
// 				style={{
// 					backgroundImage:
// 						"linear-gradient(to right, #d1d5db 1px, transparent 1px), linear-gradient(to bottom, #d1d5db 1px, transparent 1px)",
// 					backgroundSize: "32px 32px",
// 					WebkitMaskImage:
// 						"radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 70%)",
// 					maskImage:
// 						"radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 70%)",
// 				}}
// 			/>
// 			<div className="relative z-10 mx-auto max-w-7xl space-y-6">
// 				{error && (
// 					<div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
// 						<span>{error}</span>
// 						<button
// 							onClick={() => setError("")}
// 							aria-label="Dismiss error"
// 						>
// 							<X size={16} />
// 						</button>
// 					</div>
// 				)}
// 				{message && (
// 					<div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
// 						<span>{message}</span>
// 						<button
// 							onClick={() => setMessage("")}
// 							aria-label="Dismiss message"
// 						>
// 							<X size={16} />
// 						</button>
// 					</div>
// 				)}
// 				{children}
// 			</div>
// 		</div>
// 	);
// }
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
		<div className="rounded-2xl border border-white bg-white/85 p-4 shadow-sm backdrop-blur-sm">
			<div className="flex items-center gap-3">
				<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
					{icon}
				</span>
				<div className="min-w-0">
					<p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
						{label}
					</p>
					<p className="mt-0.5 truncate text-xl font-extrabold tabular-nums text-slate-900">
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
function CapacityBar({ warehouse }: { warehouse: WarehouseRow }) {
	const pct = warehouse.capacity
		? Math.min(
				100,
				Math.round(
					(warehouse.occupied_capacity / warehouse.capacity) * 100,
				),
			)
		: 0;
	return (
		<>
			<div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
				<div
					className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<div className="flex items-center justify-between text-xs text-slate-500">
				<span>
					{warehouse.racks.reduce(
						(n, rack) => n + rack.occupied_cells,
						0,
					)}{" "}
					occupied shelf positions
				</span>
				<span>
					{(
						Number(warehouse.capacity) -
						Number(warehouse.occupied_capacity)
					).toLocaleString()}{" "}
					available units
				</span>
			</div>
		</>
	);
}
function StorageLoading() {
	return (
		<div className="flex items-center justify-center rounded-2xl border border-white/70 bg-white/85 py-20 text-slate-500">
			<Loader2 className="mr-2 animate-spin" size={18} />
			Loading storage locations…
		</div>
	);
}
function totalRackPositions(warehouse: WarehouseRow) {
	return warehouse.racks.reduce((sum, rack) => sum + rack.total_cells, 0);
}
function warehouseOccupancy(warehouse: WarehouseRow) {
	return warehouse.capacity
		? Math.min(
				100,
				Math.round(
					(warehouse.occupied_capacity / warehouse.capacity) * 100,
				),
			)
		: 0;
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
function WarehouseForm({
	title,
	initial,
	divisions,
	saving,
	onCancel,
	onSubmit,
}: {
	title: string;
	initial: { name: string; capacity: string; division_id: string };
	divisions: Division[];
	saving: boolean;
	onCancel: () => void;
	onSubmit: (
		event: FormEvent<HTMLFormElement>,
		values: { name: string; capacity: string; division_id: string },
	) => Promise<void>;
}) {
	const [values, setValues] = useState(initial);
	return (
		<Dialog title={title} onClose={onCancel}>
			<form
				onSubmit={(event) => void onSubmit(event, values)}
				className="space-y-4"
			>
				<Field label="Division">
					<select
						className="input"
						value={values.division_id}
						onChange={(event) =>
							setValues((current) => ({
								...current,
								division_id: event.target.value,
							}))
						}
						required
					>
						<option value="">Select a division…</option>
						{divisions
							.filter((division) => Number(division.is_active) === 1)
							.map((division) => (
								<option key={division.id} value={String(division.id)}>
									{division.name}
								</option>
							))}
					</select>
					<p className="mt-1.5 text-xs text-slate-500">
						Storage locations belong to a single division. Select one before saving.
					</p>
				</Field>
				<Field label="Location name">
					<input
						className="input"
						value={values.name}
						onChange={(event) =>
							setValues((current) => ({
								...current,
								name: event.target.value,
							}))
						}
						placeholder="Building 1, Warehouse 123, Godown 1"
						maxLength={120}
						required
						autoFocus
					/>
				</Field>
				<Field label="Storage capacity (units)">
					<input
						className="input"
						type="number"
						min="1"
						max="1000000000"
						step="1"
						value={values.capacity}
						onChange={(event) =>
							setValues((current) => ({
								...current,
								capacity: event.target.value,
							}))
						}
						placeholder="5000"
						required
					/>
					<p className="mt-1.5 text-xs text-slate-500">
						Total quantity this storage area can hold.
					</p>
				</Field>
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
						Save location
					</button>
				</div>
			</form>
		</Dialog>
	);
}

export default function Storage() {
	const navigate = useNavigate();
	const { user, adminDivisionId } = useAuth();
	const canManage = user?.role === "ADMIN" || user?.role === "QC";
	const [divisions, setDivisions] = useState<Division[]>([]);
	useEffect(() => {
		let active = true;
		api
			.divisions.list()
			.then((list) => { if (active) setDivisions(list); })
			.catch(() => { if (active) setDivisions([]); });
		return () => { active = false; };
	}, []);
	const divisionName = (id?: EntityId | null) =>
		id == null
			? "All divisions"
			: divisions.find((division) => String(division.id) === String(id))?.name ?? "Division";
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
	const [warehouseDialog, setWarehouseDialog] = useState(false);
	const [editing, setEditing] = useState<WarehouseRow | null>(null);
	const [warehouseToDelete, setWarehouseToDelete] =
		useState<WarehouseRow | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState("");
	const debouncedSearch = useDebouncedValue(search, 250);
	const visible = useMemo(
		() =>
			warehouses.filter((warehouse) =>
				warehouse.name
					.toLowerCase()
					.includes(debouncedSearch.toLowerCase()),
			),
		[warehouses, debouncedSearch],
	);
	const rackCount = warehouses.reduce(
		(sum, warehouse) => sum + warehouse.racks.length,
		0,
	);
	const capacity = warehouses.reduce(
		(sum, warehouse) => sum + Number(warehouse.capacity || 0),
		0,
	);
	const occupied = warehouses.reduce(
		(sum, warehouse) => sum + Number(warehouse.occupied_capacity || 0),
		0,
	);

	const saveWarehouse = async (
		event: FormEvent<HTMLFormElement>,
		values: { name: string; capacity: string; division_id: string },
	) => {
		event.preventDefault();
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const payload = {
				name: values.name.trim(),
				capacity: Number(values.capacity),
				division_id: values.division_id,
			};
			if (editing) await api.storage.update(editing.id, payload);
			else await api.storage.create(payload);
			await reload();
			setWarehouseDialog(false);
			setEditing(null);
			setMessage(
				editing
					? "Storage location updated."
					: "Storage location created.",
			);
		} catch (err: any) {
			setError(err.message || "Could not save this storage location.");
		} finally {
			setSaving(false);
		}
	};

	const removeWarehouse = async (warehouse: WarehouseRow) => {
		setDeleting(true);
		setDeleteError("");
		setError("");
		setMessage("");
		try {
			await api.storage.remove(warehouse.id);
			await reload();
			setWarehouseToDelete(null);
			setMessage(`"${warehouse.name}" was deleted.`);
		} catch (err: any) {
			setDeleteError(
				err.message || "Could not delete this storage location.",
			);
		} finally {
			setDeleting(false);
		}
	};

	return (
		// <StoragePageFrame
		// 	error={error}
		// 	setError={setError}
		// 	message={message}
		// 	setMessage={setMessage}
		// >
		<div className="page-container space-y-6">
			<header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<p className="text-xs font-extrabold uppercase tracking-[0.2em] text-brand-600">
						Factory management
					</p>
					<h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
						Storage locations
					</h1>
					<p className="mt-2 text-sm text-slate-600 sm:text-base">
						Warehouses, buildings, and storage areas across your
						organization.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<label className="relative min-w-[220px] flex-1 md:w-72">
						<Search
							size={16}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
						/>
						<input
							className="input h-11 border-slate-200 bg-white/90 pl-9"
							placeholder="Search locations"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</label>
					<button
						className="btn-secondary h-11"
						onClick={() => void reload()}
						disabled={loading}
					>
						<RefreshCw
							size={15}
							className={loading ? "animate-spin" : ""}
						/>{" "}
						Refresh
					</button>
					{canManage && (
						<button
							className="btn-primary h-11"
							onClick={() => {
								setEditing(null);
								setWarehouseDialog(true);
							}}
						>
							<Plus size={16} /> Add location
						</button>
					)}
				</div>
			</header>
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
			<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Metric
					icon={<Warehouse size={20} />}
					label="Storage locations"
					value={warehouses.length}
				/>
				<Metric
					icon={<Boxes size={20} />}
					label="Total racks"
					value={rackCount}
				/>
				<Metric
					icon={<Package size={20} />}
					label="Capacity"
					value={`${capacity.toLocaleString()} units`}
				/>
				<Metric
					icon={<Building2 size={20} />}
					label="In use"
					value={`${occupied.toLocaleString()} units`}
					detail={
						capacity
							? `${Math.round((occupied / capacity) * 100)}% of total capacity`
							: "No capacity configured"
					}
				/>
			</section>
			{loading && !warehouses.length ? (
				<StorageLoading />
			) : !visible.length ? (
				<div className="rounded-2xl border border-dashed border-slate-300 bg-white/75 px-5 py-16 text-center">
					<Warehouse size={34} className="mx-auto text-slate-300" />
					<h2 className="mt-3 text-lg font-bold text-slate-800">
						{search
							? "No matching locations"
							: "No storage locations yet"}
					</h2>
					<p className="mt-1 text-sm text-slate-500">
						{search
							? "Try another name."
							: "Create a named storage area, then add racks and shelf positions."}
					</p>
					{!search && canManage && (
						<button
							className="btn-primary mt-5"
							onClick={() => setWarehouseDialog(true)}
						>
							<Plus size={15} /> Create storage location
						</button>
					)}
				</div>
			) : (
				<div className="grid gap-4 lg:grid-cols-2">
					{visible.map((warehouse) => (
						<article
							key={warehouse.id}
							className="overflow-hidden rounded-2xl border border-white bg-white/90 shadow-sm backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
						>
							<div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
								<div className="flex min-w-0 items-center gap-3">
									<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
										<Warehouse size={23} />
									</div>
									<div className="min-w-0">
										<h2 className="truncate text-xl font-extrabold text-slate-900">
											{warehouse.name}
										</h2>
										<p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-500">
											<MapPin size={12} />
											{warehouse.racks.length} racks ·{" "}
											{totalRackPositions(warehouse)}{" "}
											positions
										</p>
										<span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700">
											<Building2 size={11} /> {divisionName(warehouse.division_id)}
										</span>
									</div>
								</div>
								<span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
									Active
								</span>
							</div>
							<div className="space-y-4 p-5">
								<div className="flex items-end justify-between gap-3">
									<div>
										<p className="text-xs font-bold uppercase tracking-wide text-slate-500">
											Capacity in use
										</p>
										<p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">
											{Number(
												warehouse.occupied_capacity,
											).toLocaleString()}{" "}
											<span className="text-sm font-semibold text-slate-500">
												/{" "}
												{Number(
													warehouse.capacity,
												).toLocaleString()}
											</span>
										</p>
									</div>
									<div className="text-right text-2xl font-extrabold text-brand-700">
										{warehouseOccupancy(warehouse)}%
									</div>
								</div>
								<CapacityBar warehouse={warehouse} />
								<div className="flex flex-wrap gap-2">
									{warehouse.racks.slice(0, 5).map((rack) => (
										<span
											key={rack.id}
											className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700"
										>
											{rack.rack_code}{" "}
											<span className="font-medium text-slate-500">
												{rack.occupied_cells}/
												{rack.total_cells}
											</span>
										</span>
									))}
									{warehouse.racks.length > 5 && (
										<span className="px-2 py-1.5 text-xs font-semibold text-slate-500">
											+{warehouse.racks.length - 5} more
										</span>
									)}
								</div>
								<div className="flex gap-2">
									<button
										className="btn-primary flex-1"
										onClick={() =>
											navigate(
												`/storage/${encodeURIComponent(warehouse.id)}`,
											)
										}
									>
										View location <ChevronRight size={16} />
									</button>
									{canManage && (
										<>
											<button
												className="btn-secondary"
												onClick={() => {
													setEditing(warehouse);
													setWarehouseDialog(true);
												}}
											>
												Edit
											</button>
											<button
												className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-bold text-rose-600 transition hover:bg-rose-100"
												title="Delete storage location"
												onClick={() => {
													setDeleteError("");
													setWarehouseToDelete(warehouse);
												}}
											>
												<Trash2 size={15} /> Delete
											</button>
										</>
									)}
								</div>
							</div>
						</article>
					))}
				</div>
			)}
			{warehouseDialog && canManage && (
				<WarehouseForm
					key={editing?.id || "new"}
					title={
						editing
							? "Edit storage location"
							: "Create storage location"
					}
					initial={
						editing
							? {
									name: editing.name,
									capacity: String(editing.capacity),
									division_id: String(editing.division_id ?? ""),
								}
							: {
									name: "",
									capacity: "",
									division_id:
										adminDivisionId === "all"
											? ""
											: String(adminDivisionId),
								}
					}
					divisions={divisions}
					saving={saving}
					onCancel={() => {
						setWarehouseDialog(false);
						setEditing(null);
					}}
					onSubmit={saveWarehouse}
				/>
			)}
			{warehouseToDelete && (
				<Dialog
					title="Delete storage location"
					onClose={() => {
						if (!deleting) setWarehouseToDelete(null);
					}}
				>
					<div className="space-y-4">
						<p className="text-sm leading-relaxed text-slate-600">
							Delete <strong>{warehouseToDelete.name}</strong> and
							all of its racks and shelf positions? This cannot be
							undone. A location that still holds stock cannot be
							deleted.
						</p>
						{deleteError && (
							<p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
								{deleteError}
							</p>
						)}
						<div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
							<button
								type="button"
								className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
								disabled={deleting}
								onClick={() => setWarehouseToDelete(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60"
								disabled={deleting}
								onClick={() =>
									void removeWarehouse(warehouseToDelete)
								}
							>
								{deleting ? (
									<Loader2 size={15} className="animate-spin" />
								) : (
									<Trash2 size={15} />
								)}
								{deleting ? "Deleting…" : "Delete location"}
							</button>
						</div>
					</div>
				</Dialog>
			)}
		{/* </StoragePageFrame> */}
		</div>
	);
}
