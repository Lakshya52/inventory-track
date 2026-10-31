import { useEffect, useState, FormEvent, useMemo } from "react";
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
  Boxes,
  Sparkles,
  Scale,
  Factory,
} from "lucide-react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

function nextSku(products: Product[], itemName: string): string {
  let max = 0;
  for (const product of products) {
    const match = /^KLJ-[A-Z0-9]{3,6}-(\d+)$/i.exec((product.sku || "").trim());
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

function usableMasters(rows: MasterOption[]): MasterOption[] {
  return rows.filter(
    (row) =>
      ((typeof row.id === "string" && row.id.trim().length > 0) ||
        (typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0)) &&
      (row.is_active === true || Number(row.is_active) === 1)
  );
}

function uomLabel(
  uoms: MasterOption[],
  bagQuantities: MasterOption[],
  id?: EntityId | null
): string {
  if (id === null || id === undefined || id === "") return "-";
  const row =
    uoms.find((item) => String(item.id) === String(id)) ||
    bagQuantities.find((item) => String(item.id) === String(id));
  if (!row) return "-";
  return row.name || `${row.quantity ?? ""} ${row.unit ?? ""}`.trim() || "-";
}

export default function Products({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const canManage = !readOnly && user?.role === "ADMIN";
  const [products, setProducts] = useState<Product[]>([]);
  const [grades, setGrades] = useState<MasterOption[]>([]);
  const [uoms, setUoms] = useState<MasterOption[]>([]);
  const [bagQuantities, setBagQuantities] = useState<MasterOption[]>([]);
  const [manufacturers, setManufacturers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<EntityId | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
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
      api.masters.list("uoms"),
      api.masters.list("bag-quantities"),
      api.vendors.list({ status: "active" }),
    ])
      .then(([productRows, gradeRows, uomRows, bagQuantityRows, vendorRows]) => {
        setProducts(productRows);
        setGrades(usableMasters(gradeRows));
        setUoms(usableMasters(uomRows));
        setBagQuantities(usableMasters(bagQuantityRows));
        setManufacturers(
          (vendorRows || []).filter(
            (v: any) =>
              ((typeof v.id === "string" && v.id.trim().length > 0) ||
                (typeof v.id === "number" && Number.isSafeInteger(v.id) && v.id > 0)) &&
              (v.is_active === true || Number(v.is_active) === 1)
          )
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

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return products;
    const q = debouncedSearch.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.grade || "").toLowerCase().includes(q)
    );
  }, [products, debouncedSearch]);

  const resetForm = () => {
    setForm(initForm);
    setError("");
    setEditId(null);
  };

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
      price: String(p.price || ""),
      quantity: String(p.quantity || ""),
      cas_number: p.cas_number || "",
      molecular_formula: p.molecular_formula || "",
      purity: p.purity || "",
      grade: p.grade || "",
      bag_quantity_id:
        p.bag_quantity_id != null && p.bag_quantity_id !== "" ? String(p.bag_quantity_id) : "",
      storage_conditions: p.storage_conditions || "",
      hazard_classification: p.hazard_classification || "",
      physical_state: p.physical_state || "",
      hsn_code: p.hsn_code || "",
      manufacturer: p.manufacturer || "SELF (KLJ)",
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
      setProducts(await api.products.list());
    } catch (err: any) {
      setError(err.message || "Could not save product");
    }
  };

  const handleDelete = async (id: EntityId) => {
    const product = products.find((row) => String(row.id) === String(id));
    if (!window.confirm(`Permanently delete "${product?.name || id}"? This cannot be undone.`)) return;
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
      setError(err.message || "Could not download sample spreadsheet");
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. PAGE HEADER */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
            <Package size={24} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Products Catalogue
            </h1>
            <p className="text-sm sm:text-base text-slate-500 mt-0.5">
              Manage product master definitions, automatic SKU codes, grades, and units of measure.
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={() => void handleDownloadSample()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
              title="Download sample Excel format"
            >
              <Download size={16} /> Sample Excel
            </button>

            <label className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer transition-colors">
              <Upload size={16} /> Import Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    try {
                      await api.products.importExcel(f);
                      setProducts(await api.products.list());
                      setError("");
                    } catch (err: any) {
                      setError(err.message || "Excel import failed");
                    } finally {
                      e.target.value = "";
                    }
                  }
                }}
              />
            </label>

            <button
              onClick={openCreateForm}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-xs sm:text-sm font-bold rounded-xl transition-colors shadow-sm"
            >
              <Plus size={18} /> Add Product
            </button>
          </div>
        )}
      </div>

      {/* 2. STATS CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Products", value: products.length, icon: <Package size={20} />, bg: "bg-blue-100 text-blue-700" },
          { label: "Active Grades", value: grades.length, icon: <Sparkles size={20} />, bg: "bg-purple-100 text-purple-700" },
          { label: "Measurement Units (UOM)", value: uoms.length, icon: <Scale size={20} />, bg: "bg-emerald-100 text-emerald-700" },
          { label: "Approved Vendors", value: manufacturers.length, icon: <Factory size={20} />, bg: "bg-amber-100 text-amber-700" },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
            <div className="flex items-center gap-2.5 mb-2">
              <div className={`w-9 h-9 rounded-xl ${card.bg} flex items-center justify-center`}>
                {card.icon}
              </div>
              <span className="text-xs sm:text-sm font-bold text-slate-600 uppercase tracking-wide">
                {card.label}
              </span>
            </div>
            <div className="text-3xl font-black text-slate-900 mt-1">{card.value}</div>
          </div>
        ))}
      </div>

      {error && !showForm && (
        <div className="p-4 rounded-xl text-sm font-semibold bg-rose-50 text-rose-800 border-2 border-rose-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-rose-700 hover:text-rose-900">
            <X size={18} />
          </button>
        </div>
      )}

      {/* 3. SEARCH BAR */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-4 shadow-xs flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full pl-10 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Search products by name, SKU, or grade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search && (
          <button
            onClick={() => setSearch("")}
            className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
          >
            Clear
          </button>
        )}
      </div>

      {/* 4. PRODUCTS TABLE */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b-2 border-slate-200 text-slate-600 font-bold uppercase text-xs tracking-wider">
              <tr>
                <th className="px-6 py-4">Product Name</th>
                <th className="px-6 py-4">SKU Code</th>
                <th className="px-6 py-4">Grade</th>
                <th className="px-6 py-4">Unit of Measure (UOM)</th>
                <th className="px-6 py-4">Manufacturer</th>
                {canManage && <th className="px-6 py-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-slate-900 text-base">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-slate-400 font-medium mt-0.5 truncate max-w-xs">
                        {p.description}
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-4">
                    <span className="font-mono text-xs font-bold px-2 py-1 rounded bg-slate-100 text-slate-800 border border-slate-200">
                      {p.sku}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
                      {p.grade || "Standard"}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {uomLabel(uoms, bagQuantities, p.bag_quantity_id)}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-sm font-medium text-slate-700">
                    {p.manufacturer || "SELF (KLJ)"}
                  </td>

                  {canManage && (
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleEdit(p)}
                          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Edit Product"
                        >
                          <Pencil size={17} />
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="p-2 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete Product"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="py-12 text-center text-slate-400">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                      <Package size={24} />
                    </div>
                    <p className="text-base font-bold text-slate-700">No products found</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {search ? "Try searching for a different keyword" : "Add your first product to get started"}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. ADD / EDIT PRODUCT MODAL (Single clean form, Esc & X to close) */}
      {canManage && showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-xl w-full max-w-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {editId ? "Edit Product" : "Add New Product"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Product catalog specifications, SKU, grade, and UOM
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Product Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Product / Item Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={form.name}
                    placeholder="e.g. Chlorinated Paraffin"
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm({
                        ...form,
                        name,
                        sku: !editId ? nextSku(products, name) : form.sku,
                      });
                    }}
                    required
                    autoFocus
                  />
                </div>

                {/* SKU Code */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    SKU (Auto-Generated)
                  </label>
                  <input
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={form.sku}
                    placeholder="Auto-generated"
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  />
                </div>

                {/* Unit of Measure (UOM) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Unit of Measure (UOM)
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={form.bag_quantity_id}
                    onChange={(e) => setForm({ ...form, bag_quantity_id: e.target.value })}
                  >
                    <option value="">-- Select UOM --</option>
                    {uoms.map((u) => (
                      <option key={u.id} value={String(u.id)}>
                        {u.name}
                      </option>
                    ))}
                    {bagQuantities.map((b) => (
                      <option key={`bq-${b.id}`} value={String(b.id)}>
                        {b.name || `${b.quantity} ${b.unit}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Grade */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Grade
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={form.grade}
                    onChange={(e) => setForm({ ...form, grade: e.target.value })}
                  >
                    <option value="">-- Select Grade --</option>
                    {grades.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Manufacturer */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Manufacturer
                  </label>
                  <select
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={form.manufacturer}
                    onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                  >
                    <option value="SELF (KLJ)">SELF (KLJ)</option>
                    {manufacturers.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Hazard Classification */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Hazard Classification (Optional)
                  </label>
                  <textarea
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    rows={2}
                    placeholder="Hazard classification or handling notes"
                    value={form.hazard_classification}
                    onChange={(e) => setForm({ ...form, hazard_classification: e.target.value })}
                  />
                </div>

                {/* Storage Conditions */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1.5">
                    Storage Conditions (Optional)
                  </label>
                  <textarea
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    rows={2}
                    placeholder="e.g. Store in a cool, well-ventilated dry place"
                    value={form.storage_conditions}
                    onChange={(e) => setForm({ ...form, storage_conditions: e.target.value })}
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-800">
                  {error}
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
                >
                  {editId ? "Update Product" : "Create Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
