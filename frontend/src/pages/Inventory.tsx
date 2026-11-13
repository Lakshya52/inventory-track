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

type InventoryRecord = {
	id?: string | number;
	product_id?: string | number;
	product_name?: string | null;
	product_sku?: string | null;
	product_grade?: string | null;
	grade_name?: string | null;
	package_quantity?: number | string | null;
	bag_quantity_name?: string | null;
	bag_quantity?: number | string | null;
	bag_quantity_unit?: string | null;
	quantity?: number | string | null;
	remaining_quantity?: number | string | null;
	uom?: string | null;
	warehouse_id?: string | number | null;
	rack_id?: string | number | null;
	location_code?: string | null;
};

type PackageStock = {
	key: string;
	name: string;
	detail: string;
	count: number;
	countUnit: string;
	totalContent: number;
	contentUnit: string;
};

type StockRow = {
	key: string;
	productKey: string;
	grade: string;
	product: string;
	sku: string;
	packages: PackageStock[];
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
	const [inventory, setInventory] = useState<InventoryRecord[]>([]);
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
		} catch (err: unknown) {
			setError(
				err instanceof Error
					? err.message
					: "Could not load inventory.",
			);
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	const rows = useMemo<StockRow[]>(
		() => {
			const grouped = new Map<string, StockRow>();
			for (const item of inventory) {
				const quantity = Number(
					item.remaining_quantity ?? item.quantity ?? 0,
				);
				if (!Number.isFinite(quantity) || quantity <= 0) continue;

				const product = item.product_name || "Unknown product";
				const grade =
					item.grade_name || item.product_grade || "Standard Grade";
				const productKey = String(
					item.product_id ?? (item.product_sku || product),
				);
				const key = JSON.stringify([productKey, grade]);
				let row = grouped.get(key);
				if (!row) {
					row = {
						key,
						productKey,
						grade,
						product,
						sku: item.product_sku || "—",
						packages: [],
					};
					grouped.set(key, row);
				}

				const packageSize = Number(
					item.package_quantity ?? item.bag_quantity ?? 0,
				);
				const hasPackageSize =
					Number.isFinite(packageSize) && packageSize > 0;
				const packageName = item.bag_quantity_name?.trim() || "";
				const hasPackaging = hasPackageSize || Boolean(packageName);
				const contentUnit = item.uom?.trim() || "units";
				const packageUnit =
					item.package_quantity != null
						? contentUnit
						: item.bag_quantity_unit?.trim() || contentUnit;
				const packageSizeLabel = hasPackageSize
					? `${packageSize.toLocaleString()} ${packageUnit}`
					: "";
				const packageLabel =
					packageName ||
					(hasPackageSize
						? `${packageSizeLabel} pack`
						: "Packaging not recorded");
				const detail = hasPackageSize
					? `${packageSizeLabel} per pack`
					: hasPackaging
						? "Package size not recorded"
						: "Packaging not recorded";
				const countUnit = hasPackaging ? "packs" : contentUnit;
				const totalContentUnit = hasPackageSize
					? packageUnit
					: hasPackaging
						? "packs"
						: contentUnit;
				const packageKey = JSON.stringify([
					packageLabel,
					hasPackageSize ? packageSize : null,
					packageUnit.toLowerCase(),
					countUnit.toLowerCase(),
				]);
				const stock = row.packages.find(
					(entry) => entry.key === packageKey,
				);
				if (stock) {
					stock.count += quantity;
					stock.totalContent +=
						quantity * (hasPackageSize ? packageSize : 1);
				} else {
					row.packages.push({
						key: packageKey,
						name: packageLabel,
						detail,
						count: quantity,
						countUnit,
						totalContent:
							quantity * (hasPackageSize ? packageSize : 1),
						contentUnit: totalContentUnit,
					});
				}
			}
			return [...grouped.values()].sort(
				(a, b) =>
					a.grade.localeCompare(b.grade) ||
					a.product.localeCompare(b.product),
			);
		},
		[inventory],
	);

	const visibleRows = useMemo(() => {
		const term = debouncedSearch.trim().toLowerCase();
		return rows.filter(
			(row) =>
				!term ||
				[row.grade, row.product, row.sku].some((value) =>
					value.toLowerCase().includes(term),
				) ||
				row.packages.some((stock) =>
					`${stock.name} ${stock.detail}`
						.toLowerCase()
						.includes(term),
				),
		);
	}, [rows, debouncedSearch]);
	const quantitiesByUom = new Map<
		string,
		{ uom: string; quantity: number }
	>();
	for (const row of rows) {
		for (const stock of row.packages) {
			const key = stock.contentUnit.toLowerCase();
			const existing = quantitiesByUom.get(key);
			quantitiesByUom.set(key, {
				uom: existing?.uom ?? stock.contentUnit,
				quantity:
					(existing?.quantity ?? 0) + stock.totalContent,
			});
		}
	}
	const uomEntries = [...quantitiesByUom.values()].map(({ uom, quantity }) => [
		uom,
		quantity,
	] as const);
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
				? "Across all storage locations"
				: "No stock recorded";
	const productCount = new Set(rows.map((row) => row.productKey)).size;
	const occupiedPositions = new Set(
		inventory
			.filter(
				(item) =>
					Number(item.remaining_quantity ?? item.quantity ?? 0) > 0,
			)
			.map(
				(item) =>
					`${item.warehouse_id ?? ""}:${item.rack_id ?? ""}:${item.location_code ?? ""}`,
			),
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
						Live quantities by product grade across all storage
						locations.
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
					label="Product grades"
					value={rows.length.toLocaleString()}
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
							Stock by product
						</h2>
						<p className="mt-0.5 text-sm text-slate-500">
							Quantities are combined across batches and storage
							locations.
						</p>
					</div>
					<label className="relative w-full sm:max-w-sm">
						<Search
							size={16}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
						/>
						<input
							className="input h-10 pl-9"
							placeholder="Search product, grade, packaging, or SKU…"
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
								? "Try another product, grade, packaging, or SKU."
								: "Create a QC stock batch to see inventory here."}
						</p>
					</div>
				) : (
					<div>
						<div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(220px,1fr)_minmax(150px,0.65fr)] gap-4 bg-slate-50 px-5 py-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500 lg:grid">
							<span>Grade and product</span>
							<span>Packaging</span>
							<span>Available stock</span>
						</div>
						<div className="divide-y divide-slate-100">
							{visibleRows.map((row) => (
								<div
									key={row.key}
									className="grid gap-4 px-4 py-4 transition-colors hover:bg-slate-50/70 sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(220px,1fr)_minmax(150px,0.65fr)] lg:items-center"
								>
									<div className="min-w-0">
										<p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-indigo-600 lg:hidden">
											Product
										</p>
										<span className="inline-flex max-w-full rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
											<span className="truncate">
												{row.grade}
											</span>
										</span>
										<h3 className="mt-2 break-words text-base font-bold leading-snug text-slate-900">
											{row.product}
										</h3>
										<p className="mt-1 truncate font-mono text-xs text-slate-500">
											SKU: {row.sku}
										</p>
									</div>
									<div className="min-w-0">
										<p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500 lg:hidden">
											Packaging
										</p>
										<div className="space-y-2">
											{row.packages.map((stock) => (
												<div
													key={stock.key}
													className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
												>
													<p className="break-words text-sm font-bold text-slate-800">
														{stock.name}
													</p>
													<p className="mt-0.5 text-xs text-slate-500">
														{stock.detail}
													</p>
												</div>
											))}
										</div>
									</div>
									<div className="min-w-0">
										<p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500 lg:hidden">
											Available stock
										</p>
										<div className="space-y-2">
											{row.packages.map((stock) => (
												<div
													key={stock.key}
													className="rounded-lg bg-emerald-50 px-3 py-2 lg:bg-transparent lg:px-0 lg:py-0"
												>
													<p className="text-base font-extrabold tabular-nums text-emerald-800 lg:text-slate-900">
														{stock.count.toLocaleString()}{" "}
														<span className="text-sm font-semibold">
															{stock.countUnit}
														</span>
													</p>
													<p className="mt-0.5 text-xs font-medium text-slate-500">
														{stock.totalContent.toLocaleString()}{" "}
														{stock.contentUnit} total
													</p>
												</div>
											))}
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				)}
				<div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">
					<span>{visibleRows.length} product grades</span>
					<span>Dispatch users have view-only access</span>
				</div>
			</section>
		</div>
	);
}
