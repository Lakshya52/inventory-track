import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
	Boxes,
	Building2,
	ChevronLeft,
	ChevronRight,
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

const PAGE_SIZE = 25;

export default function Inventory() {
	const { user } = useAuth();
	const navigate = useNavigate();
	const [response, setResponse] = useState<Awaited<
		ReturnType<typeof api.storage.inventory>
	> | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const debouncedSearch = useDebouncedValue(search, 250);
	const canManage = user?.role === "ADMIN" || user?.role === "QC";

	// Grouping, searching and pagination all happen in the database now. The
	// browser only receives the rows it is about to render plus global KPIs.
	const load = useCallback(async (force = false) => {
		setLoading(true);
		setError("");
		try {
			const result = await api.storage.inventory({
				q: debouncedSearch,
				page,
				limit: PAGE_SIZE,
				refresh: force,
			});
			if (result.page > result.pages && result.pages > 0) {
				setPage(result.pages);
			}
			setResponse(result);
		} catch (err: unknown) {
			setError(
				err instanceof Error
					? err.message
					: "Could not load inventory.",
			);
		} finally {
			setLoading(false);
		}
	}, [debouncedSearch, page]);
	useEffect(() => {
		void load();
	}, [load]);

	const rows = (response?.rows ?? []) as StockRow[];
	const total = response?.total ?? 0;
	const pages = response?.pages ?? 1;
	const summary = response?.summary;

	const uomEntries = (summary?.stockByUom ?? []).map(({ uom, quantity }) => [
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
	const productCount = summary?.productCount ?? 0;
	const gradeCount = summary?.gradeCount ?? 0;
	const occupiedPositions = summary?.occupiedPositions ?? 0;

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
						onClick={() => void load(true)}
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
					value={gradeCount.toLocaleString()}
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
							onChange={(event) => {
								setSearch(event.target.value);
								setPage(1);
							}}
						/>
					</label>
				</div>
				{loading ? (
					<div className="p-12 text-center text-sm text-slate-500">
						Loading inventory…
					</div>
				) : rows.length === 0 ? (
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
							{rows.map((row) => (
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
				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">
					<span>
						{total.toLocaleString()} product grades · page {page} of{" "}
						{pages.toLocaleString()}
					</span>
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="btn-secondary btn-sm"
							disabled={loading || page <= 1}
							onClick={() => setPage((current) => Math.max(1, current - 1))}
						>
							<ChevronLeft size={13} /> Previous
						</button>
						<button
							type="button"
							className="btn-secondary btn-sm"
							disabled={loading || page >= pages}
							onClick={() => setPage((current) => current + 1)}
						>
							Next <ChevronRight size={13} />
						</button>
					</div>
				</div>
			</section>
		</div>
	);
}
