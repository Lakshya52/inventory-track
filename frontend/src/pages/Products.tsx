import { useEffect, useState, FormEvent } from "react";
import { api } from "../services/api";
import { EntityId, Product } from "../types";
import { useAuth } from "../contexts/AuthContext";
import {
	Package,
	Plus,
	Search,
	Download,
	Upload,
	Pencil,
	Trash2,
	X,
	RefreshCw,
} from "lucide-react";

// old function
// function nextSku(products: Product[]): string {
// 	let max = 0;
// 	for (const product of products) {
// 		const match = /^KLJ-(\d+)$/i.exec((product.sku || "").trim());
// 		if (match) max = Math.max(max, Number(match[1]));
// 	}
// 	return `KLJ-${form.name}-${String(max + 1).padStart(3, "0")}`;
// }

function nextSku(products: Product[], itemName: string): string {
	let max = 0;

	for (const product of products) {
		const match = /^KLJ-[A-Z0-9]{3}-(\d+)$/i.exec(
			(product.sku || "").trim(),
		);
		if (match) max = Math.max(max, Number(match[1]));
	}

	const itemCode = itemName
		.trim()
		.replace(/[^a-zA-Z0-9]/g, "")
		.substring(0, 6)
		.toUpperCase();

	if (!itemCode) return "";

	return `KLJ-${itemCode}-${String(max + 1).padStart(3, "0")}`;
}

type MasterOption = {
	id: EntityId;
	name?: string;
	quantity?: number;
	unit?: string;
	is_active?: number | boolean | null;
};

/** Master rows are only selectable when they have a usable id and are active. */
function usableMasters(rows: MasterOption[]): MasterOption[] {
	return rows.filter(
		(row) =>
			((typeof row.id === "string" && row.id.trim().length > 0) ||
				(typeof row.id === "number" &&
					Number.isSafeInteger(row.id) &&
					row.id > 0)) &&
			(row.is_active === true || Number(row.is_active) === 1),
	);
}

function bagQuantityLabel(rows: MasterOption[], id?: EntityId | null): string {
	if (id === null || id === undefined || id === "") return "-";
	const row = rows.find((item) => String(item.id) === String(id));
	if (!row) return "-";
	return row.name || `${row.quantity ?? ""} ${row.unit ?? ""}`.trim() || "-";
}

export default function Products({ readOnly = false }: { readOnly?: boolean }) {
	const { user } = useAuth();
	const canManage = !readOnly && user?.role === "ADMIN";
	const [products, setProducts] = useState<Product[]>([]);
	const [grades, setGrades] = useState<MasterOption[]>([]);
	const [bagQuantities, setBagQuantities] = useState<MasterOption[]>([]);
	const [manufacturers, setManufacturers] = useState<any[]>([]);
	const [showForm, setShowForm] = useState(false);
	const [editId, setEditId] = useState<EntityId | null>(null);
	const [search, setSearch] = useState("");
	const [error, setError] = useState("");

	const initForm = {
		name: "",
		description: "",
		sku: "",
		price: "",
		quantity: "",
		cas_number: "",
		molecular_formula: "",
		purity: "",
		grade: "",
		bag_quantity_id: "",
		storage_conditions: "",
		hazard_classification: "",
		physical_state: "",
		hsn_code: "",
		manufacturer: "SELF (KLJ)",
	};
	const [form, setForm] = useState(initForm);

	useEffect(() => {
		Promise.all([
			api.products.list(),
			api.masters.list("grades"),
			api.masters.list("bag-quantities"),
			api.vendors.list({ status: "active" }),
		])
			.then(([productRows, gradeRows, bagQuantityRows, vendorRows]) => {
				setProducts(productRows);
				setGrades(usableMasters(gradeRows));
				setBagQuantities(usableMasters(bagQuantityRows));
				setManufacturers(
					(vendorRows || []).filter(
						(vendor: any) =>
							((typeof vendor.id === "string" && vendor.id.trim().length > 0) ||
								(typeof vendor.id === "number" &&
									Number.isSafeInteger(vendor.id) &&
									vendor.id > 0)) &&
							(vendor.is_active === true || Number(vendor.is_active) === 1),
					),
				);
			})
			.catch((err: Error) => setError(err.message));
	}, []);

	useEffect(() => {
		if (!showForm) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setShowForm(false);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [showForm]);

	const filtered = products.filter(
		(p) =>
			!search ||
			p.name.toLowerCase().includes(search.toLowerCase()) ||
			p.sku.toLowerCase().includes(search.toLowerCase()),
	);

	const resetForm = () => {
		setForm(initForm);
		setError("");
		setEditId(null);
	};

	// const openCreateForm = () => {
	// 	setForm({ ...initForm, sku: nextSku(products) });
	// 	setError("");
	// 	setEditId(null);
	// 	setShowForm(true);
	// };
	const openCreateForm = () => {
		setForm(initForm);
		setError("");
		setEditId(null);
		setShowForm(true);
	};

	const handleEdit = (p: Product) => {
		setForm({
			name: p.name,
			description: p.description || "",
			sku: p.sku,
			price: String(p.price),
			quantity: String(p.quantity),
			cas_number: p.cas_number || "",
			molecular_formula: p.molecular_formula || "",
			purity: p.purity || "",
			grade: p.grade || "",
			bag_quantity_id:
				p.bag_quantity_id != null && p.bag_quantity_id !== ""
					? String(p.bag_quantity_id)
					: "",
			storage_conditions: p.storage_conditions || "",
			hazard_classification: p.hazard_classification || "",
			physical_state: p.physical_state || "",
			hsn_code: p.hsn_code || "",
			manufacturer: p.manufacturer || "",
		});
		setEditId(p.id);
		setShowForm(true);
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError("");
		try {
			const data = {
				...form,
				sku: form.sku.trim(),
				price: Number(form.price) || 0,
				quantity: Number(form.quantity) || 0,
				bag_quantity_id: form.bag_quantity_id || null,
			};
			if (editId) {
				await api.products.update(editId, data);
			} else {
				await api.products.create(data);
			}
			setShowForm(false);
			resetForm();
			try {
				setProducts(await api.products.list());
			} catch (refreshError: any) {
				setError(
					`Product saved, but the list could not be refreshed: ${refreshError.message || "Request failed."}`,
				);
			}
		} catch (err: any) {
			setError(err.message);
		}
	};

	const handleDelete = async (id: EntityId) => {
		const product = products.find((row) => String(row.id) === String(id));
		if (
			!window.confirm(
				`Delete product "${product?.name || id}"? This cannot be undone.`,
			)
		)
			return;
		setError("");
		try {
			await api.products.delete(id);
			setProducts(await api.products.list());
		} catch (err: any) {
			setError(err.message || "Could not delete product");
		}
	};

	const handleDownloadSample = async () => {
		setError("");
		try {
			await api.products.downloadSample();
		} catch (err: any) {
			setError(
				err.message || "Could not download the sample spreadsheet",
			);
		}
	};

	return (
		<div className="page-container">
			<div className="page-header">
				<div>
					<h1 className="page-title">Products</h1>
					<p className="page-subtitle">
						Manage your product catalog and inventory
					</p>
				</div>
				{canManage && (
					<div className="flex flex-wrap gap-2">
						<button
							onClick={() => void handleDownloadSample()}
							className="btn-secondary btn-sm"
						>
							<Download size={14} /> Sample
						</button>
						<label className="btn-secondary btn-sm cursor-pointer">
							<Upload size={14} /> Import
							<input
								type="file"
								accept=".xlsx,.xls"
								className="hidden"
								onChange={async (e) => {
									const f = e.target.files?.[0];
									if (f) {
										try {
											await api.products.importExcel(f);
											const list =
												await api.products.list();
											setProducts(list);
											setError("");
										} catch (err: any) {
											setError(
												err.message || "Import failed",
											);
										} finally {
											e.target.value = "";
										}
									}
								}}
							/>
						</label>
						<button
							onClick={openCreateForm}
							className="btn-primary"
						>
							<Plus size={16} /> Add Product
						</button>
					</div>
				)}
			</div>
			{error && !showForm && (
				<div className="mb-4 p-3 rounded-xl text-sm flex items-center justify-between bg-rose-50 text-rose-700 border border-rose-200">
					<span>{error}</span>
					<button
						onClick={() => setError("")}
						className="text-rose-500 hover:text-rose-700"
					>
						<X size={15} />
					</button>
				</div>
			)}

			{canManage && showForm && (
				<div className="modal-overlay">
					<div
						className="modal-content max-w-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="modal-header">
							<h2 className="text-base font-semibold text-surface-900">
								{editId ? "Edit" : "Add"} Product
							</h2>
							<button
								onClick={() => setShowForm(false)}
								className="btn-ghost btn-sm"
							>
								<X size={16} />
							</button>
						</div>
						<form onSubmit={handleSubmit}>
							<div className="modal-body space-y-4">
								<div className="form-grid">
									<div className="space-y-1.5">
										<label className="input-label">
											Item / Product Name <span className="text-rose-500">*</span>
										</label>
										<input
											className="input"
											value={form.name}
											// onChange={(e) =>
											// 	setForm({
											// 		...form,
											// 		name: e.target.value,
											// 	})
											// }
											onChange={(e) => {
												const name = e.target.value;

												setForm({
													...form,
													name,
													sku: !editId ? nextSku( products, name) : form.sku,
												});
											}}
											required
										/>
									</div>

									<div className="space-y-1.5">
										<label className="input-label">
											SKU (Auto-generated)
										</label>
										<div className="relative">
											<input
												className="input pr-10 font-mono"
												value={form.sku}
												disabled={true}
												onChange={(e) =>
													setForm({
														...form,
														sku: e.target.value,
													})
												}
												required
											/>
											{/* <button
												type="button"
												onClick={() =>
													setForm({
														...form,
														sku: nextSku(products),
													})
												}
												className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-surface-400 hover:bg-brand-50 hover:text-brand-600"
												title="Generate next SKU"
												aria-label="Generate next SKU"
											>
												<RefreshCw size={14} />
											</button> */}
										</div>
										{/* <p className="text-[11px] text-surface-400">
											Auto-generated. You can edit it.
										</p> */}


                    {/* ========================= */}
                    {/* <p className="text-[11px] text-surface-400">
                      Company name + Item Name + Number{" "}
                      <br /> e.g. KLJ-CHM-001
                    </p> */}
                    {/* ========================= */}

									</div>

									{/* <div className="space-y-1.5">
										<label className="input-label">
											Price (₹)
										</label>
										<input
											className="input"
											type="number"
											step="0.01"
											value={form.price}
											onChange={(e) =>
												setForm({
													...form,
													price: e.target.value,
												})
											}
										/>
									</div> */}
									<div className="space-y-1.5">
										<label className="input-label">
											Stock Quantity
										</label>
										<input
											className="input"
											type="number"
											step="0.001"
											value={form.quantity}
											onChange={(e) =>
												setForm({
													...form,
													quantity: e.target.value,
												})
											}
										/>
									</div>

									<div className="space-y-1.5">
										<label
											className="input-label"
											htmlFor="product-bag-quantity"
										>
											Quantity Type
										</label>
										<select
											id="product-bag-quantity"
											className="select"
											value={form.bag_quantity_id}
											onChange={(e) =>
												setForm({
													...form,
													bag_quantity_id:
														e.target.value,
												})
											}
										>
											<option value="">
												-- Select Type --
											</option>
											{bagQuantities.map((value) => (
												<option
													key={value.id}
													value={String(value.id)}
												>
													{value.name ||
														`${value.quantity ?? ""} ${value.unit ?? ""}`.trim()}
												</option>
											))}
										</select>
										{bagQuantities.length === 0 && (
											<p className="text-xs text-surface-400">
												Add bag quantities in Masters
												before assigning one.
											</p>
										)}
									</div>

									{/* <div className="space-y-1.5">
										<label className="input-label">
											CAS Number
										</label>
										<input
											className="input"
											value={form.cas_number}
											onChange={(e) =>
												setForm({
													...form,
													cas_number: e.target.value,
												})
											}
										/>
									</div> */}

									{/* can be restore  */}
									{/* <div className="space-y-1.5">
										<label className="input-label">
											Molecular Formula
										</label>
										<input
											className="input"
											value={form.molecular_formula}
											onChange={(e) =>
												setForm({
													...form,
													molecular_formula:
														e.target.value,
												})
											}
										/>
									</div> */}
									{/* <div className="space-y-1.5">
										<label className="input-label">
											Purity
										</label>
										<input
											className="input"
											value={form.purity}
											onChange={(e) =>
												setForm({
													...form,
													purity: e.target.value,
												})
											}
										/>
									</div> */}

									<div className="space-y-1.5">
										<label
											className="input-label"
											htmlFor="product-grade"
										>
											Grade
										</label>
										<select
											id="product-grade"
											className="select"
											value={form.grade}
											onChange={(e) =>
												setForm({
													...form,
													grade: e.target.value,
												})
											}
										>
											<option value="">
												-- Select Grade --
											</option>
											{grades.map((grade) => (
												<option
													key={grade.id}
													value={grade.name ?? ""}
												>
													{grade.name}
												</option>
											))}
										</select>
										{grades.length === 0 && (
											<p className="text-xs text-surface-400">
												Add grade values in Masters
												before creating new grades.
											</p>
										)}
									</div>

									{/* <div className="space-y-1.5">
										<label className="input-label">
											Physical State
										</label>
										<input
											className="input"
											value={form.physical_state}
											onChange={(e) =>
												setForm({
													...form,
													physical_state:
														e.target.value,
												})
											}
										/>
									</div> */}

									<div className="space-y-1.5">
										<label className="input-label">
											Manufacturer
										</label>
										<select
											id="product-manufacturer"
											className="select"
											value={form.manufacturer}
											onChange={(e) =>
												setForm({
													...form,
													manufacturer:
														e.target.value,
												})
											}
										>
											<option value="">
												-- Select Manufacturer --
											</option>
											{manufacturers.map((manufacturer) => {
												const value =
													manufacturer.vendor_code === "SELF"
														? "SELF (KLJ)"
														: manufacturer.name;
												return (
													<option key={String(manufacturer.id)} value={value}>
														{value}
													</option>
												);
											})}
											{form.manufacturer &&
												!manufacturers.some(
													(manufacturer) =>
														(manufacturer.vendor_code === "SELF" ? "SELF (KLJ)" : manufacturer.name) === form.manufacturer,
												) && (
													<option value={form.manufacturer}>{form.manufacturer}</option>
												)}
										</select>
									</div>

									<div className="space-y-1.5">
										<label className="input-label">
											HSN Code
										</label>
										<input
											className="input"
											value={form.hsn_code}
											onChange={(e) =>
												setForm({
													...form,
													hsn_code: e.target.value,
												})
											}
										/>
									</div>

									<div className="space-y-1.5">
										<label className="input-label">
											Hazard Classification
										</label>
										<input
											className="input"
											value={form.hazard_classification}
											onChange={(e) =>
												setForm({
													...form,
													hazard_classification:
														e.target.value,
												})
											}
										/>
									</div>
								</div>
								<div className="space-y-1.5">
									<label className="input-label">
										Description
									</label>
									<textarea
										className="input"
										rows={2}
										value={form.description}
										onChange={(e) =>
											setForm({
												...form,
												description: e.target.value,
											})
										}
									/>
								</div>
								<div className="space-y-1.5">
									<label className="input-label">
										Storage Conditions
									</label>
									<textarea
										className="input"
										rows={2}
										value={form.storage_conditions}
										onChange={(e) =>
											setForm({
												...form,
												storage_conditions:
													e.target.value,
											})
										}
									/>
								</div>
								{error && (
									<div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-xl">
										{error}
									</div>
								)}
							</div>
							<div className="modal-footer">
								<button
									type="button"
									onClick={() => setShowForm(false)}
									className="btn-secondary"
								>
									Cancel
								</button>
								<button type="submit" className="btn-primary">
									{editId ? "Update" : "Create"} Product
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			<div className="flex items-center gap-3 mb-4">
				<div className="relative flex-1 max-w-full sm:max-w-xs">
					<Search
						size={16}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
					/>
					<input
						className="input pl-9"
						placeholder="Search products..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				{search && (
					<button
						onClick={() => setSearch("")}
						className="btn-ghost btn-sm shrink-0"
					>
						<X size={14} /> Clear
					</button>
				)}
			</div>

			<div className="card">
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>SKU</th>
								{/* <th>Price</th> */}
								<th>Qty</th>
								{/* <th>CAS</th> */}
								<th>Grade</th>
								<th>Bag Qty</th>
								{canManage && <th>Actions</th>}
							</tr>
						</thead>
						<tbody>
							{filtered.map((p) => (
								<tr key={p.id}>
									<td>
										<div className="font-medium text-surface-800">
											{p.name}
										</div>
										{p.description && (
											<div className="text-xs text-surface-400 truncate max-w-[200px]">
												{p.description}
											</div>
										)}
									</td>
									<td>
										<span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-lg">
											{p.sku}
										</span>
									</td>
									{/* <td>
										{p.price > 0
											? `₹${Number(p.price).toLocaleString()}`
											: "-"}
									</td> */}
									<td>{p.quantity}</td>
									{/* <td className="font-mono text-xs">
										{p.cas_number || "-"}
									</td> */}
									<td>{p.grade || "-"}</td>
									<td>
										{bagQuantityLabel(
											bagQuantities,
											p.bag_quantity_id,
										)}
									</td>
									{canManage && (
										<td>
											<div className="flex gap-1">
												<button
													onClick={() =>
														handleEdit(p)
													}
													className="btn-ghost btn-sm"
												>
													<Pencil size={14} />
												</button>
												<button
													onClick={() =>
														handleDelete(p.id)
													}
													className="btn-ghost btn-sm text-rose-500 hover:text-rose-600"
												>
													<Trash2 size={14} />
												</button>
											</div>
										</td>
									)}
								</tr>
							))}
							{filtered.length === 0 && (
								<tr>
									<td colSpan={canManage ? 8 : 7}>
										<div className="empty-state">
											<div className="empty-icon">
												<Package
													size={24}
													className="text-surface-400"
												/>
											</div>
											<div className="empty-title">
												No products found
											</div>
											<div className="empty-desc">
												{search
													? "Try a different search term"
													: "No products are available yet"}
											</div>
										</div>
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
