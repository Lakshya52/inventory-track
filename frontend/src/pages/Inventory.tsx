import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
	Boxes,
	Building2,
	MapPin,
	Package,
	RefreshCw,
	Search,
	Warehouse,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type StockRow = {
	key: string;
	product: string;
	sku: string;
	batch: string;
	quantity: number;
	uom: string;
	warehouse: string;
	rack: string;
	location: string;
	warehouseId: string;
	rackId: string;
	cellCode: string;
};

function Metric({
	label,
	value,
	detail,
	icon,
}: {
	label: string;
	value: string;
	detail?: string;
	icon: React.ReactNode;
}) {
	return (
		<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
			<div className="flex items-center gap-3">
				<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
					{icon}
				</span>
				<div className="min-w-0">
					<p className="text-xs font-bold uppercase tracking-wide text-slate-500">
						{label}
					</p>
					<p className="mt-1 truncate text-2xl font-extrabold tabular-nums text-slate-900">
						{value}
					</p>
					{detail && (
						<p className="mt-0.5 truncate text-xs font-medium text-slate-500">
							{detail}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

export default function Inventory() {
	const { user } = useAuth();
	const navigate = useNavigate();
	const [inventory, setInventory] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 250);
	const canManage = user?.role === "ADMIN" || user?.role === "QC";

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			setInventory(await api.storage.inventory());
		} catch (err: any) {
			setError(err.message || "Could not load inventory.");
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	const rows = useMemo<StockRow[]>(
		() =>
			inventory
				.filter(
					(item) =>
						Number(item.remaining_quantity ?? item.quantity ?? 0) >
						0,
				)
				.map((item) => ({
					key: String(item.id),
					product: item.product_name || "Unknown product",
					sku: item.product_sku || "—",
					batch: item.batch_number || "—",
					quantity: Number(
						item.remaining_quantity ?? item.quantity ?? 0,
					),
					uom: item.uom || "units",
					warehouse: item.warehouse || "Unassigned warehouse",
					rack: item.rack || "—",
					location: item.location_code || "Unassigned",
					warehouseId: item.warehouse_id
						? String(item.warehouse_id)
						: "",
					rackId: item.rack_id ? String(item.rack_id) : "",
					cellCode: String(item.location_code || ""),
				})),
		[inventory],
	);

	const visibleRows = useMemo(() => {
		const term = debouncedSearch.trim().toLowerCase();
		return rows.filter(
			(row) =>
				!term ||
				[
					row.product,
					row.sku,
					row.batch,
					row.warehouse,
					row.rack,
					row.location,
				].some((value) => value.toLowerCase().includes(term)),
		);
	}, [rows, debouncedSearch]);
	const quantitiesByUom = rows.reduce<Record<string, number>>(
		(totals, row) => {
			const uom = row.uom.trim() || "units";
			totals[uom] = (totals[uom] || 0) + row.quantity;
			return totals;
		},
		{},
	);
	const uomEntries = Object.entries(quantitiesByUom);
	const stockValue =
		uomEntries.length === 0
			? "0"
			: uomEntries.length === 1
				? `${uomEntries[0][1].toLocaleString()} ${uomEntries[0][0]}`
				: `${uomEntries.length} UOMs`;
	const stockDetail =
		uomEntries.length > 1
			? uomEntries
					.map(
						([uom, quantity]) =>
							`${quantity.toLocaleString()} ${uom}`,
					)
					.join(" · ")
			: uomEntries.length === 1
				? "On hand across all warehouses"
				: "No stock recorded";
	const productCount = new Set(
		rows.map((row) => (row.sku !== "—" ? row.sku : row.product)),
	).size;
	const occupiedPositions = new Set(
		rows
			.filter((row) => row.quantity > 0)
			.map((row) => `${row.warehouseId}:${row.rackId}:${row.cellCode}`),
	).size;

	return (
		<div className="mx-auto max-w-7xl space-y-5">
			<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-extrabold uppercase tracking-[0.18em] text-indigo-600">
						Stock overview
					</p>
					<h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">
						Inventory
					</h1>
					<p className="mt-1 text-sm text-slate-500">
						Live quantities by product, batch, and rack position.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Link to="/storage" className="btn-secondary">
						<Warehouse size={15} /> Warehouse layout
					</Link>
					{canManage && (
						<>
							<Link
								to="/shelf-locations"
								className="btn-secondary"
							>
								<MapPin size={15} /> Shelf locations
							</Link>
							<button
								className="btn-primary"
								onClick={() => navigate("/batches")}
							>
								<Boxes size={15} /> Add stock
							</button>
						</>
					)}
					<button
						className="btn-secondary"
						onClick={() => void load()}
						disabled={loading}
						aria-label="Refresh inventory"
					>
						<RefreshCw
							size={15}
							className={loading ? "animate-spin" : ""}
						/>
					</button>
				</div>
			</header>

			{error && (
				<div
					role="alert"
					className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
				>
					{error}
				</div>
			)}
			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Metric
					label="On-hand stock"
					value={stockValue}
					detail={stockDetail}
					icon={<Package size={20} />}
				/>
				<Metric
					label="Products stocked"
					value={productCount.toLocaleString()}
					icon={<Boxes size={20} />}
				/>
				<Metric
					label="Stock lines"
					value={rows
						.filter((row) => row.quantity > 0)
						.length.toLocaleString()}
					icon={<MapPin size={20} />}
				/>
				<Metric
					label="Occupied positions"
					value={occupiedPositions.toLocaleString()}
					icon={<Building2 size={20} />}
				/>
			</section>

			<section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
				<div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
					<div>
						<h2 className="text-lg font-extrabold text-slate-900">
							Stock by location
						</h2>
						<p className="mt-0.5 text-sm text-slate-500">
							Quantities reflect dispatches and recalls already
							finalized.
						</p>
					</div>
					<label className="relative w-full sm:max-w-sm">
						<Search
							size={16}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
						/>
						<input
							className="input h-10 pl-9"
							placeholder="Search product, SKU, batch, location…"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</label>
				</div>
				{loading ? (
					<div className="p-12 text-center text-sm text-slate-500">
						Loading inventory…
					</div>
				) : visibleRows.length === 0 ? (
					<div className="p-12 text-center">
						<Package className="mx-auto text-slate-300" size={30} />
						<p className="mt-3 font-bold text-slate-700">
							{search
								? "No matching stock"
								: "No stock in storage yet"}
						</p>
						<p className="mt-1 text-sm text-slate-500">
							{search
								? "Try another product, batch, or location."
								: "Create a QC stock batch to see inventory here."}
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[900px] text-left text-sm">
							<thead className="bg-slate-50 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
								<tr>
									<th className="px-5 py-3">Product</th>
									<th className="px-5 py-3">Batch</th>
									<th className="px-5 py-3 text-right">
										On hand
									</th>
									<th className="px-5 py-3">
										Storage location
									</th>
									<th className="px-5 py-3">Rack position</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{visibleRows.map((row) => (
									<tr
										key={row.key}
										className="hover:bg-slate-50/70"
									>
										<td className="px-5 py-3">
											<div className="font-bold text-slate-900">
												{row.product}
											</div>
											<div className="mt-0.5 font-mono text-xs text-slate-500">
												{row.sku}
											</div>
										</td>
										<td className="px-5 py-3">
											<span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-700">
												{row.batch}
											</span>
										</td>
										<td className="px-5 py-3 text-right">
											<span className="font-extrabold tabular-nums text-slate-900">
												{row.quantity.toLocaleString()}
											</span>
											<span className="ml-1.5 text-xs font-semibold text-slate-500">
												x {row.uom}
											</span>
										</td>
										<td className="px-5 py-3">
											<div className="font-semibold text-slate-800">
												{row.warehouse}
											</div>
											<div className="text-xs text-slate-500">
												{row.rack}
											</div>
										</td>
										<td className="px-5 py-3">
											<button
												className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-extrabold text-blue-800 hover:bg-blue-100"
												disabled={
													!row.warehouseId ||
													!row.rackId
												}
												onClick={() =>
													navigate(
														`/storage/${encodeURIComponent(row.warehouseId)}/racks/${encodeURIComponent(row.rackId)}?location=${encodeURIComponent(row.location)}`,
													)
												}
											>
												<MapPin size={13} />
												{row.location}
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">
					<span>{visibleRows.length} stock lines</span>
					<span>Dispatch users have view-only access</span>
				</div>
			</section>
		</div>
	);
}
