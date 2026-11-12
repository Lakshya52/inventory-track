import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { EntityId, Product } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  Download,
  Factory,
  Layers,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type MasterOption = {
  id: EntityId;
  name?: string;
  quantity?: number;
  unit?: string;
  is_active?: number | boolean | null;
};

type GradeDraft = {
  key: string;
  grade: string;
  sku: string;
  skuTouched: boolean;
  bag_quantity_id: string;
};

type FamilyForm = {
  name: string;
  description: string;
  manufacturer: string;
};

type FamilyGroup = {
  name: string;
  description: string;
  manufacturer: string;
  products: Product[];
};

function newGradeDraft(): GradeDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    grade: "",
    sku: "",
    skuTouched: false,
    bag_quantity_id: "",
  };
}

function familySkuPrefix(name: string): string {
  const code = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  return `KLJ-${code || "PROD"}`;
}

/**
 * Mirrors the backend rule: KLJ-<6-char product code>-NNN where NNN is the
 * next number that is not already used by any grade or draft.
 */
function nextSku(products: Product[], name: string, reserved: Set<string>): string {
  const prefix = familySkuPrefix(name);
  const numbered = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let sequence = 1;
  const consider = (sku: string) => {
    const match = numbered.exec(sku.trim());
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  };
  products.forEach((product) => consider(String(product.sku || "")));
  reserved.forEach(consider);
  let candidate = `${prefix}-${String(sequence).padStart(3, "0")}`;
  while (
    reserved.has(candidate.toLowerCase()) ||
    products.some(
      (product) => String(product.sku || "").trim().toLowerCase() === candidate.toLowerCase()
    )
  ) {
    sequence += 1;
    candidate = `${prefix}-${String(sequence).padStart(3, "0")}`;
  }
  return candidate;
}

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
  if (id === null || id === undefined || id === "") return "—";
  const row =
    uoms.find((item) => String(item.id) === String(id)) ||
    bagQuantities.find((item) => String(item.id) === String(id));
  if (!row) return "—";
  return row.name || `${row.quantity ?? ""} ${row.unit ?? ""}`.trim() || "—";
}

export default function Products({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN";

  const [products, setProducts] = useState<Product[]>([]);
  const [uoms, setUoms] = useState<MasterOption[]>([]);
  const [bagQuantities, setBagQuantities] = useState<MasterOption[]>([]);
  const [manufacturers, setManufacturers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showFamilyForm, setShowFamilyForm] = useState(false);
  const [familyMode, setFamilyMode] = useState<"create" | "add-grade">("create");
  const [familyForm, setFamilyForm] = useState<FamilyForm>({
    name: "",
    description: "",
    manufacturer: "SELF (KLJ)",
  });
  const [gradeDrafts, setGradeDrafts] = useState<GradeDraft[]>([newGradeDraft()]);
  const [saving, setSaving] = useState(false);

  const [renameFamilyName, setRenameFamilyName] = useState<string | null>(null);
  const [renameForm, setRenameForm] = useState({ name: "", description: "" });

  const [editGrade, setEditGrade] = useState<Product | null>(null);
  const [gradeForm, setGradeForm] = useState({
    grade: "",
    sku: "",
    bag_quantity_id: "",
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [productRows, uomRows, bagQuantityRows, vendorRows] = await Promise.all([
        api.products.list(),
        api.masters.list("uoms"),
        api.masters.list("bag-quantities"),
        api.vendors.list({ status: "active" }),
      ]);
      setProducts(productRows || []);
      setUoms(usableMasters(uomRows || []));
      setBagQuantities(usableMasters(bagQuantityRows || []));
      setManufacturers(
        (vendorRows || []).filter(
          (vendor: any) =>
            ((typeof vendor.id === "string" && vendor.id.trim().length > 0) ||
              (typeof vendor.id === "number" && Number.isSafeInteger(vendor.id) && vendor.id > 0)) &&
            (vendor.is_active === true || Number(vendor.is_active) === 1)
        )
      );
    } catch (err: any) {
      setError(err.message || "Could not load products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!showFamilyForm && !renameFamilyName && !editGrade) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      setShowFamilyForm(false);
      setRenameFamilyName(null);
      setEditGrade(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showFamilyForm, renameFamilyName, editGrade, saving]);

  const families = useMemo<FamilyGroup[]>(() => {
    const groups = new Map<string, FamilyGroup>();
    for (const product of products) {
      const displayName = (product.name || "").trim() || "Unnamed product";
      const key = displayName.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, {
          name: displayName,
          description: product.description || "",
          manufacturer: product.manufacturer || "SELF (KLJ)",
          products: [],
        });
      }
      const group = groups.get(key)!;
      if (!group.description && product.description) group.description = product.description;
      group.products.push(product);
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        products: [...group.products].sort((a, b) =>
          (a.grade || "").localeCompare(b.grade || "")
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const filteredFamilies = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return families;
    return families.filter(
      (family) =>
        family.name.toLowerCase().includes(query) ||
        family.description.toLowerCase().includes(query) ||
        family.products.some(
          (product) =>
            (product.grade || "").toLowerCase().includes(query) ||
            (product.sku || "").toLowerCase().includes(query) ||
            (product.manufacturer || "").toLowerCase().includes(query)
        )
    );
  }, [families, debouncedSearch]);

  const resetFamilyForm = () => {
    setFamilyForm({ name: "", description: "", manufacturer: "SELF (KLJ)" });
    setGradeDrafts([newGradeDraft()]);
    setError("");
  };

  const openCreateProduct = () => {
    resetFamilyForm();
    setFamilyMode("create");
    setNotice("");
    setShowFamilyForm(true);
  };

  const openAddGrade = (family: FamilyGroup) => {
    resetFamilyForm();
    setFamilyForm({
      name: family.name,
      description: family.description,
      manufacturer: family.manufacturer,
    });
    const draft = newGradeDraft();
    draft.sku = nextSku(products, family.name, new Set());
    setGradeDrafts([draft]);
    setFamilyMode("add-grade");
    setNotice("");
    setShowFamilyForm(true);
  };

  const closeFamilyForm = () => {
    setShowFamilyForm(false);
    resetFamilyForm();
  };

  /** Regenerates SKUs for rows the user has not edited by hand. */
  const refreshAutoSkus = (name: string) => {
    setGradeDrafts((current) => {
      const reserved = new Set(
        current
          .filter((draft) => draft.skuTouched && draft.sku.trim())
          .map((draft) => draft.sku.trim().toLowerCase())
      );
      return current.map((draft) => {
        if (draft.skuTouched) return draft;
        const sku = name.trim() ? nextSku(products, name, reserved) : "";
        if (sku) reserved.add(sku.toLowerCase());
        return { ...draft, sku };
      });
    });
  };

  const addGradeDraft = () => {
    setGradeDrafts((current) => {
      const reserved = new Set(
        current.filter((draft) => draft.sku.trim()).map((draft) => draft.sku.trim().toLowerCase())
      );
      const draft = newGradeDraft();
      if (familyForm.name.trim()) {
        draft.sku = nextSku(products, familyForm.name, reserved);
      }
      return [...current, draft];
    });
  };

  const updateGradeDraft = (index: number, patch: Partial<GradeDraft>) => {
    setGradeDrafts((current) =>
      current.map((grade, gradeIndex) =>
        gradeIndex === index
          ? { ...grade, ...patch, ...(patch.sku !== undefined ? { skuTouched: true } : {}) }
          : grade
      )
    );
  };

  const handleFamilySubmit = async (event: FormEvent) => {
    event.preventDefault();
    const name = familyForm.name.trim();
    if (!name) {
      setError("Enter a product name.");
      return;
    }
    const emptyGrade = gradeDrafts.find((grade) => !grade.grade.trim());
    if (emptyGrade) {
      setError("Enter a grade name for every grade row.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api.products.createFamily({
        name,
        description: familyForm.description.trim() || undefined,
        manufacturer: familyForm.manufacturer || undefined,
        grades: gradeDrafts.map((grade) => ({
          grade: grade.grade.trim(),
          sku: grade.sku.trim() || undefined,
          bag_quantity_id: grade.bag_quantity_id || null,
        })),
      });
      setNotice(result.message || `${name} saved.`);
      closeFamilyForm();
      await load();
    } catch (err: any) {
      setError(err.message || "Could not save product");
    } finally {
      setSaving(false);
    }
  };

  const openRename = (family: FamilyGroup) => {
    setRenameFamilyName(family.name);
    setRenameForm({ name: family.name, description: family.description });
    setError("");
  };

  const handleRenameSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameFamilyName) return;
    const name = renameForm.name.trim();
    if (!name) {
      setError("Enter a product name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.products.renameFamily({
        currentName: renameFamilyName,
        name,
        description: renameForm.description.trim(),
      });
      setNotice(`Product renamed to ${name}.`);
      setRenameFamilyName(null);
      await load();
    } catch (err: any) {
      setError(err.message || "Could not rename product");
    } finally {
      setSaving(false);
    }
  };

  const openEditGrade = (product: Product) => {
    setEditGrade(product);
    setGradeForm({
      grade: product.grade || "",
      sku: product.sku || "",
      bag_quantity_id:
        product.bag_quantity_id != null && product.bag_quantity_id !== ""
          ? String(product.bag_quantity_id)
          : "",
    });
    setError("");
  };

  const handleGradeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editGrade) return;
    const gradeName = gradeForm.grade.trim();
    if (!gradeName || !gradeForm.sku.trim()) {
      setError("Grade name and SKU are required.");
      return;
    }
    const sibling = products.find(
      (product) =>
        String(product.id) !== String(editGrade.id) &&
        (product.name || "").trim().toLowerCase() ===
          (editGrade.name || "").trim().toLowerCase() &&
        (product.grade || "").trim().toLowerCase() === gradeName.toLowerCase()
    );
    if (sibling) {
      setError(`Grade "${gradeName}" already exists for ${editGrade.name}.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.products.update(editGrade.id, {
        name: editGrade.name,
        description: editGrade.description || "",
        sku: gradeForm.sku.trim(),
        price: Number(editGrade.price) || 0,
        quantity: editGrade.quantity || 0,
        cas_number: editGrade.cas_number || "",
        molecular_formula: editGrade.molecular_formula || "",
        purity: editGrade.purity || "",
        grade: gradeName,
        bag_quantity_id: gradeForm.bag_quantity_id || null,
        storage_conditions: editGrade.storage_conditions || "",
        hazard_classification: editGrade.hazard_classification || "",
        physical_state: editGrade.physical_state || "",
        hsn_code: editGrade.hsn_code || "",
        manufacturer: editGrade.manufacturer || "SELF (KLJ)",
      });
      setNotice(`Grade ${gradeName} updated.`);
      setEditGrade(null);
      await load();
    } catch (err: any) {
      setError(err.message || "Could not update grade");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGrade = async (product: Product) => {
    const label = product.grade ? `${product.grade} (${product.sku})` : product.sku;
    if (
      !window.confirm(
        `Delete grade ${label}? This only works if the grade has no batches yet.`
      )
    ) {
      return;
    }
    setError("");
    setNotice("");
    try {
      await api.products.delete(product.id);
      setNotice(`Grade ${label} deleted.`);
      await load();
    } catch (err: any) {
      setError(err.message || "Could not delete grade");
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

  const totalGrades = products.length;
  const stats = [
    {
      label: "Products",
      value: families.length,
      icon: <Package size={20} />,
      bg: "bg-blue-100 text-blue-700",
    },
    {
      label: "Grades",
      value: totalGrades,
      icon: <Layers size={20} />,
      bg: "bg-purple-100 text-purple-700",
    },
    {
      label: "Units (UOM)",
      value: uoms.length,
      icon: <Scale size={20} />,
      bg: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Suppliers",
      value: manufacturers.length,
      icon: <Factory size={20} />,
      bg: "bg-amber-100 text-amber-700",
    },
  ];

  return (
    <div className={embedded ? "space-y-5" : "page-container space-y-6"}>
      {!embedded && (
        <div className="flex flex-col gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
              <Package size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                Product catalogue
              </h1>
              <p className="mt-0.5 text-sm text-slate-500 sm:text-base">
                Create each product with all of its sellable grades.
              </p>
            </div>
          </div>
          {canManage && (
            <button onClick={openCreateProduct} className="btn-primary">
              <Plus size={18} /> Add product
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Product catalogue</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            One product can have many grades. Batches and sales use the grade.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadSample()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 sm:text-sm"
              title="Download sample Excel format"
            >
              <Download size={16} /> Sample Excel
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 sm:text-sm">
              <Upload size={16} /> Import Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    await api.products.importExcel(file);
                    setNotice("Products imported.");
                    setError("");
                    await load();
                  } catch (err: any) {
                    setError(err.message || "Excel import failed");
                  } finally {
                    event.target.value = "";
                  }
                }}
              />
            </label>
            <button onClick={openCreateProduct} className="btn-primary">
              <Plus size={18} /> Add product
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-xs"
          >
            <div className="mb-2 flex items-center gap-2.5">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${stat.bg}`}>
                {stat.icon}
              </div>
              <span className="text-xs font-bold uppercase tracking-wide text-slate-600 sm:text-sm">
                {stat.label}
              </span>
            </div>
            <div className="mt-1 text-3xl font-black text-slate-900">
              {loading ? "—" : stat.value}
            </div>
          </div>
        ))}
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-emerald-700 hover:text-emerald-900">
            <X size={18} />
          </button>
        </div>
      )}

      {error && !showFamilyForm && !renameFamilyName && !editGrade && (
        <div className="flex items-center justify-between rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-rose-700 hover:text-rose-900">
            <X size={18} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-xs">
        <div className="relative flex-1">
          <Search
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-3.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Search product, grade, or SKU..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200"
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {loading && products.length === 0 ? (
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-12 text-center text-sm font-semibold text-slate-500">
          Loading products...
        </div>
      ) : filteredFamilies.length === 0 ? (
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-12 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Package size={24} />
          </div>
          <p className="text-base font-bold text-slate-700">No products found</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {products.length
              ? "Try a different search term."
              : "Add your first product and its grades to get started."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFamilies.map((family) => (
            <section
              key={family.name.toLowerCase()}
              className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xs"
            >
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <Package size={22} />
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-900">{family.name}</h3>
                    {family.description && (
                      <p className="text-sm text-slate-500">{family.description}</p>
                    )}
                    <p className="mt-0.5 text-xs font-semibold text-slate-400">
                      {family.products.length} grade{family.products.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openAddGrade(family)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700"
                    >
                      <Plus size={16} /> Add grade
                    </button>
                    <button
                      type="button"
                      onClick={() => openRename(family)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      <Pencil size={16} /> Rename
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b-2 border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-5 py-3">Grade</th>
                      <th className="px-5 py-3">SKU</th>
                      <th className="px-5 py-3">UOM</th>
                      <th className="px-5 py-3">Manufacturer</th>
                      {canManage && <th className="px-5 py-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {family.products.map((product) => (
                      <tr key={product.id} className="transition-colors hover:bg-slate-50/80">
                        <td className="px-5 py-3.5">
                          <span className="text-base font-bold text-slate-900">
                            {product.grade || "Standard"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="rounded border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-800">
                            {product.sku}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                            {uomLabel(uoms, bagQuantities, product.bag_quantity_id)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm font-medium text-slate-700">
                          {product.manufacturer || family.manufacturer || "SELF (KLJ)"}
                        </td>
                        {canManage && (
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => openEditGrade(product)}
                                className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                                title="Edit grade"
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                onClick={() => void handleDeleteGrade(product)}
                                className="rounded-lg p-2 text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-800"
                                title="Delete grade"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {showFamilyForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border-2 border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {familyMode === "create" ? "Add product" : `Add grade to ${familyForm.name}`}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {familyMode === "create"
                    ? "Enter the product name, then add every grade you sell under it."
                    : "The new grade will be added under this product."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeFamilyForm}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                disabled={saving}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleFamilySubmit} className="space-y-5 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                    Product name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500"
                    value={familyForm.name}
                    onChange={(event) => {
                      const value = event.target.value;
                      setFamilyForm((current) => ({ ...current, name: value }));
                      if (familyMode === "create") refreshAutoSkus(value);
                    }}
                    placeholder="e.g. TPR COMPOUND"
                    required
                    autoFocus={familyMode === "create"}
                    disabled={familyMode === "add-grade"}
                    maxLength={150}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                    Description (optional)
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={familyForm.description}
                    onChange={(event) =>
                      setFamilyForm({ ...familyForm, description: event.target.value })
                    }
                    placeholder="Short description"
                    maxLength={500}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                    Manufacturer
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={familyForm.manufacturer}
                    onChange={(event) =>
                      setFamilyForm({ ...familyForm, manufacturer: event.target.value })
                    }
                  >
                    <option value="SELF (KLJ)">SELF (KLJ)</option>
                    {manufacturers.map((manufacturer) => (
                      <option key={manufacturer.id} value={manufacturer.name}>
                        {manufacturer.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-slate-100 bg-slate-50/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Grades in this product</h3>
                    <p className="text-xs text-slate-500">
                      Each grade is sold separately and gets its own SKU.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addGradeDraft}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand-700 shadow-xs ring-1 ring-slate-200 hover:bg-brand-50"
                  >
                    <Plus size={14} /> Add grade
                  </button>
                </div>

                <div className="space-y-3">
                  {gradeDrafts.map((grade, index) => (
                    <div
                      key={grade.key}
                      className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto]"
                    >
                      <div>
                        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          Grade name <span className="text-rose-500">*</span>
                        </label>
                        <input
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={grade.grade}
                          onChange={(event) =>
                            updateGradeDraft(index, { grade: event.target.value })
                          }
                          placeholder="e.g. KLJ BD 65 L BK"
                          required
                          maxLength={100}
                          autoFocus={index === 0 && familyMode === "create"}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          SKU (auto-generated)
                        </label>
                        <input
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={grade.sku}
                          onChange={(event) => updateGradeDraft(index, { sku: event.target.value })}
                          placeholder="Auto-generated"
                          maxLength={80}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          UOM
                        </label>
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={grade.bag_quantity_id}
                          onChange={(event) =>
                            updateGradeDraft(index, { bag_quantity_id: event.target.value })
                          }
                        >
                          <option value="">Select UOM</option>
                          {uoms.map((uom) => (
                            <option key={uom.id} value={String(uom.id)}>
                              {uom.name}
                            </option>
                          ))}
                          {bagQuantities.map((bag) => (
                            <option key={`bag-${bag.id}`} value={String(bag.id)}>
                              {bag.name || `${bag.quantity} ${bag.unit}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() =>
                            setGradeDrafts((current) =>
                              current.length === 1
                                ? [newGradeDraft()]
                                : current.filter((_, gradeIndex) => gradeIndex !== index)
                            )
                          }
                          className="rounded-lg p-2 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                          title="Remove grade"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={closeFamilyForm}
                  className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Saving..."
                    : familyMode === "create"
                    ? "Create product"
                    : "Add grade"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {renameFamilyName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Rename product</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  This updates the name for every grade under it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRenameFamilyName(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                disabled={saving}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleRenameSubmit} className="space-y-4 p-6">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                  Product name <span className="text-rose-500">*</span>
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={renameForm.name}
                  onChange={(event) => setRenameForm({ ...renameForm, name: event.target.value })}
                  required
                  autoFocus
                  maxLength={150}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                  Description (optional)
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={renameForm.description}
                  onChange={(event) =>
                    setRenameForm({ ...renameForm, description: event.target.value })
                  }
                  maxLength={500}
                />
              </div>
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">
                  {error}
                </div>
              )}
              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setRenameFamilyName(null)}
                  className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save name"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editGrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border-2 border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Edit grade</h2>
                <p className="mt-0.5 text-xs text-slate-500">{editGrade.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditGrade(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                disabled={saving}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleGradeSubmit} className="space-y-4 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                    Grade name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={gradeForm.grade}
                    onChange={(event) => setGradeForm({ ...gradeForm, grade: event.target.value })}
                    required
                    maxLength={100}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                    SKU <span className="text-rose-500">*</span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={gradeForm.sku}
                    onChange={(event) => setGradeForm({ ...gradeForm, sku: event.target.value })}
                    required
                    maxLength={80}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                    UOM
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={gradeForm.bag_quantity_id}
                    onChange={(event) =>
                      setGradeForm({ ...gradeForm, bag_quantity_id: event.target.value })
                    }
                  >
                    <option value="">Select UOM</option>
                    {uoms.map((uom) => (
                      <option key={uom.id} value={String(uom.id)}>
                        {uom.name}
                      </option>
                    ))}
                    {bagQuantities.map((bag) => (
                      <option key={`bag-${bag.id}`} value={String(bag.id)}>
                        {bag.name || `${bag.quantity} ${bag.unit}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">
                  {error}
                </div>
              )}
              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditGrade(null)}
                  className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Update grade"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
