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
	Warehouse,
	X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

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
	saving,
	onCancel,
	onSubmit,
}: {
	title: string;
	initial: { name: string; capacity: string };
	saving: boolean;
	onCancel: () => void;
	onSubmit: (
		event: FormEvent<HTMLFormElement>,
		values: { name: string; capacity: string },
	) => Promise<void>;
}) {
	const [values, setValues] = useState(initial);
	return (
		<Dialog title={title} onClose={onCancel}>
			<form
				onSubmit={(event) => void onSubmit(event, values)}
				className="space-y-4"
			>
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
	const [warehouseDialog, setWarehouseDialog] = useState(false);
	const [editing, setEditing] = useState<WarehouseRow | null>(null);
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
		values: { name: string; capacity: string },
	) => {
		event.preventDefault();
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const payload = {
				name: values.name.trim(),
				capacity: Number(values.capacity),
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
										<button
											className="btn-secondary"
											onClick={() => {
												setEditing(warehouse);
												setWarehouseDialog(true);
											}}
										>
											Edit
										</button>
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
								}
							: { name: "", capacity: "" }
					}
					saving={saving}
					onCancel={() => {
						setWarehouseDialog(false);
						setEditing(null);
					}}
					onSubmit={saveWarehouse}
				/>
			)}
		{/* </StoragePageFrame> */}
		</div>
	);
}
