import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import { Division, EntityId, Product } from "../types";
import { useAuth } from "../contexts/AuthContext";
import DivisionContextNote from "../components/DivisionContextNote";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import FamilyGradesPanel from "../components/FamilyGradesPanel";
import ImportWizard from "../components/ImportWizard";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Factory,
  Info,
  AlertTriangle,
  Layers,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Trash2,
  Upload,
  X,
  EyeOff,
  Eye,
  LoaderCircle
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

type FamilySummary = {
  name: string;
  description: string | null;
  manufacturer: string | null;
  count: number;
  divisionIds?: Array<EntityId | null>;
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

function parseSkuValue(sku: string): { prefix: string; nextSequence: number; padLen: number } | null {
  const match = /^(.*)-(\d+)$/.exec(String(sku ?? "").trim());
  if (!match) return null;
  return { prefix: match[1], nextSequence: Number(match[2]), padLen: match[2].length };
}

function usableMasters(rows: MasterOption[]): MasterOption[] {
  return rows.filter(
    (row) =>
      ((typeof row.id === "string" && row.id.trim().length > 0) ||
        (typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0)) &&
      (row.is_active === true || Number(row.is_active) === 1)
  );
}

// "SELF (KLJ)" is always offered as a built-in manufacturer option. Compare
// names loosely so vendors like "Self" or "SELF (KLJ)" don't appear twice.
function normalizeManufacturer(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function familyDivisionLabels(
  family: FamilySummary,
  divisions: Division[],
): string[] {
  const ids = family.divisionIds || [];
  if (ids.length === 0) return [];
  return ids.map((id) =>
    id == null
      ? "Shared (all divisions)"
      : divisions.find((division) => String(division.id) === String(id))?.name ||
        `Division ${id}`,
  );
}

function displayManufacturer(name: unknown): string {
  const key = normalizeManufacturer(name);
  return !key || key === "self" ? "SELF (KLJ)" : String(name ?? "");
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
  const { user, adminDivisionId } = useAuth();
  const canManage = user?.role === "ADMIN";
  // Only meaningful when an admin is looking across every division.
  const showDivisionBadges = user?.role === "ADMIN" && adminDivisionId === "all";

  const [families, setFamilies] = useState<FamilySummary[]>([]);
  // The full list above powers pickers/typeahead; the table shows one page.
  const [pagedFamilies, setPagedFamilies] = useState<FamilySummary[]>([]);
  const [familyPage, setFamilyPage] = useState(1);
  const [familyPageSize, setFamilyPageSize] = useState(25);
  const [familyTotal, setFamilyTotal] = useState(0);
  const [familyPages, setFamilyPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [uoms, setUoms] = useState<MasterOption[]>([]);
  const [bagQuantities, setBagQuantities] = useState<MasterOption[]>([]);
  const [manufacturers, setManufacturers] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showFamilyForm, setShowFamilyForm] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [deactivatedFamilies, setDeactivatedFamilies] = useState<FamilySummary[] | null>(null);
  const [deactivatedLoading, setDeactivatedLoading] = useState(false);
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [familyMode, setFamilyMode] = useState<"create" | "add-grade">("create");
  const [familyForm, setFamilyForm] = useState<FamilyForm>({
    name: "",
    description: "",
    manufacturer: "SELF (KLJ)",
  });
  // Typeahead state for the Product name combobox ("searchable dropdown")
  const [familySuggestOpen, setFamilySuggestOpen] = useState(false);
  const [familySuggestIndex, setFamilySuggestIndex] = useState(-1);
  const familySuggestRef = useRef<HTMLDivElement>(null);
  const [gradeDrafts, setGradeDrafts] = useState<GradeDraft[]>([newGradeDraft()]);
  const [saving, setSaving] = useState(false);

  const [renameFamilyName, setRenameFamilyName] = useState<string | null>(null);
  const [confirmFamily, setConfirmFamily] = useState<{ family: FamilySummary; confirm: 'delete' | 'deactivate' } | null>(null);
  const [confirmFamilyRunning, setConfirmFamilyRunning] = useState(false);
  const [renameForm, setRenameForm] = useState({ name: "", description: "" });

  const [editGrade, setEditGrade] = useState<Product | null>(null);
  const [gradeError, setGradeError] = useState("");
  const [gradeForm, setGradeForm] = useState({
    grade: "",
    sku: "",
    bag_quantity_id: "",
  });

  const isSearching = debouncedSearch.trim().length > 0;

  const searchResults = useMemo(() => [] as Product[], []);

  const loadFamiliesPage = async (page = familyPage, pageSize = familyPageSize) => {
    let result = await api.products.familiesPaged(page, pageSize);
    // A delete can empty the last page — step back instead of showing nothing.
    if (result.page > result.pages && result.pages > 0) {
      setFamilyPage(result.pages);
      result = await api.products.familiesPaged(result.pages, pageSize);
    }
    setPagedFamilies(result.items || []);
    if (result.allFamilies) setFamilies(result.allFamilies);
    setFamilyTotal(result.total);
    setFamilyPages(result.pages);
    setFamilyPage(result.page);
    return result;
  };

  const changePage = (page: number) => {
    if (page < 1 || page > familyPages || page === familyPage) return;
    setFamilyPage(page);
    void loadFamiliesPage(page, familyPageSize).catch(() => {});
  };

  const changePageSize = (size: number) => {
    setFamilyPageSize(size);
    setFamilyPage(1);
    void loadFamiliesPage(1, size).catch(() => {});
  };

  const pageButtons = useMemo<(number | string)[]>(() => {
    if (familyPages <= 7) return Array.from({ length: familyPages }, (_, i) => i + 1);
    const start = Math.max(2, Math.min(familyPage - 2, familyPages - 5));
    const end = Math.min(familyPages - 1, start + 4);
    const buttons: (number | string)[] = [1];
    if (start > 2) buttons.push("…");
    for (let page = start; page <= end; page += 1) buttons.push(page);
    if (end < familyPages - 1) buttons.push("…");
    buttons.push(familyPages);
    return buttons;
  }, [familyPage, familyPages]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [uomRows, bagQuantityRows, vendorRows, divisionRows] = await Promise.all([
        api.masters.list("uoms"),
        api.masters.list("bag-quantities"),
        api.vendors.list({ status: "active" }),
        api.divisions.list(),
      ]);
      setDivisions(divisionRows || []);
      // The paged endpoint now returns all families too — one aggregation pass
      // instead of running the full catalogue scan a second time.
      const familyResult = await loadFamiliesPage();
      const familyRows = familyResult?.allFamilies ?? [];
      setTotalProducts(familyRows.reduce((sum: number, f: any) => sum + Number(f.count || 0), 0));
      // Keep families the user has expanded — only drop ones that no longer exist (renamed/deleted for good)
      const familyNames = new Set(familyRows.map((f: any) => String(f.name || "").trim().toLowerCase()));
      setExpanded((current) => new Set([...current].filter((key) => familyNames.has(key))));
      setRefreshKey((key) => key + 1);
      setUoms(usableMasters(uomRows || []));
      setBagQuantities(usableMasters(bagQuantityRows || []));
      const seenManufacturers = new Set<string>();
      setManufacturers(
        (vendorRows || []).filter((vendor: any) => {
          const hasId =
            (typeof vendor.id === "string" && vendor.id.trim().length > 0) ||
            (typeof vendor.id === "number" && Number.isSafeInteger(vendor.id) && vendor.id > 0);
          const isActive = vendor.is_active === true || Number(vendor.is_active) === 1;
          if (!hasId || !isActive) return false;
          const key = normalizeManufacturer(vendor.name);
          // Skip vendors that are just another spelling of the built-in
          // "SELF (KLJ)" option, and any duplicate names among vendors.
          if (!key || key === "self" || seenManufacturers.has(key)) return false;
          seenManufacturers.add(key);
          return true;
        })
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

  const toggleFamily = (family: string) => {
    const key = family.toLowerCase();
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const filteredFamilies = useMemo(() => pagedFamilies, [pagedFamilies]);

  // Typeahead: existing products (families) matching the current input, best first
  const familyQuery = familyForm.name.trim().toLowerCase();
  const familySuggestions = useMemo(
    () => families
      .filter((family) => !familyQuery || family.name.toLowerCase().includes(familyQuery))
      .slice(0, 8),
    [families, familyQuery]
  );
  // Exact match — submitting adds grades to this existing product instead of creating a duplicate
  const matchedFamily = useMemo(
    () => (familyQuery ? families.find((family) => family.name.toLowerCase() === familyQuery) ?? null : null),
    [families, familyQuery]
  );

  // Existing grades of the matched family — fetched ONCE per selection.
  // Two triggers: (a) selecting a suggestion from the dropdown fires immediately; (b) a typed
  // exact match goes through a 250 ms trailing debounce so typing through "TPR D1 P1" →
  // "TPR D1 P10" doesn't fire mid-way. Superseded fetches are discarded via a sequence counter;
  // the check afterwards is a pure in-memory set lookup, scoped to the selected product.
  const debouncedMatchedName = useDebouncedValue(matchedFamily?.name ?? "", 250);
  const [existingGrades, setExistingGrades] = useState<Set<string>>(new Set());
  const [existingCheckState, setExistingCheckState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const lastFetchedFamilyRef = useRef<string | null>(null);
  const catalogueSeqRef = useRef(0);

  const loadFamilyCatalogue = (name: string) => {
    lastFetchedFamilyRef.current = name;
    catalogueSeqRef.current += 1;
    const seq = catalogueSeqRef.current;
    setExistingCheckState("loading");
    (async () => {
      const grades = new Set<string>();
      const limit = 200;
      let page = 1;
      let totalPages = 1;
      do {
        const res = await api.products.familyProducts(name, page, limit);
        for (const row of res.products ?? []) {
          const grade = String(row.grade ?? "").trim().toLowerCase();
          if (grade) grades.add(grade);
        }
        totalPages = Math.max(1, Number(res.totalPages) || 1);
        page += 1;
      } while (page <= totalPages);
      if (seq !== catalogueSeqRef.current) return; // superseded — a newer family was selected/typed
      setExistingGrades(grades);
      setExistingCheckState("ready");
    })().catch(() => { if (seq === catalogueSeqRef.current) setExistingCheckState("error"); });
  };

  useEffect(() => {
    const name = debouncedMatchedName;
    if (!name) {
      lastFetchedFamilyRef.current = null;
      catalogueSeqRef.current += 1; // drop any in-flight fetch
      setExistingGrades(new Set());
      setExistingCheckState("idle");
      return;
    }
    if (name === lastFetchedFamilyRef.current) return; // already loading/loaded this exact family
    loadFamilyCatalogue(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMatchedName]);

  // SKU auto-fill straight from the SERVER's next-free-sequence: tenant-wide, and
  // gap-aware — the server computes max(^PREFIX-N$) + 1 across every product of the
  // tenant, not "how many grades this family has".
  const skuFetchSeqRef = useRef(0);
  const skuFillFromServer = (name: string) => {
    const reqId = ++skuFetchSeqRef.current;
    api.products.nextSku(name)
      .then(({ sku }) => {
        if (reqId !== skuFetchSeqRef.current) return; // superseded by a newer name / manual edit path
        const base = parseSkuValue(sku);
        if (!base) return;
        setGradeDrafts((current) => {
          let seq = base.nextSequence;
          return current.map((draft) => draft.skuTouched ? draft : { ...draft, sku: `${base.prefix}-${String(seq++).padStart(base.padLen, "0")}` });
        });
      })
      .catch(() => { /* offline — untouched rows stay blank; submit is blocked anyway when empty */ });
  };

  // Fire the SKU auto-fill when a typed name settles (250 ms of quiet). Names picked from
  // the dropdown fill immediately (see selectFamilySuggestion / openAddGrade below).
  const skuSettleName = useDebouncedValue(familyForm.name.trim(), 250);
  useEffect(() => {
    if (skuSettleName && /[A-Za-z0-9]/.test(skuSettleName)) skuFillFromServer(skuSettleName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuSettleName]);

  // Tenant-wide SKU duplicate check — SKU uniqueness spans products, not families, so the
  // lookup is debounced at typing-stop and searches the WHOLE catalogue (server-side cap 100,
  // exact-match filter client-side). Confirmed duplicates block save like the other checks.
  const debouncedSkuSignature = useDebouncedValue(JSON.stringify(gradeDrafts.map((draft) => draft.sku.trim().toLowerCase())), 800);
  const [skuLookup, setSkuLookup] = useState<{ checking: boolean; error: boolean; existing: Set<string> }>({ checking: false, error: false, existing: new Set() });
  useEffect(() => {
    const parsed: string[] = debouncedSkuSignature ? JSON.parse(debouncedSkuSignature) as string[] : [];
    const unique = [...new Set(parsed.filter(Boolean))];
    if (unique.length === 0) {
      setSkuLookup({ checking: false, error: false, existing: new Set() });
      return undefined;
    }
    let cancelled = false;
    setSkuLookup((current) => ({ ...current, checking: true, error: false }));
    const known = new Set<string>();
    Promise.all(unique.map(async (sku) => {
      try {
        const rows = await api.products.search(sku);
        if ((rows ?? []).some((row: any) => String(row?.sku ?? "").trim().toLowerCase() === sku)) known.add(sku);
      } catch { /* leave unknown — server keeps the 400 backstop */ }
    })).then(() => {
      if (cancelled) return;
      setSkuLookup((current) => ({ ...current, checking: false, error: false, existing: known }));
    }).catch(() => { if (!cancelled) setSkuLookup((current) => ({ ...current, checking: false, error: true })); });
    return () => { cancelled = true; };
  }, [debouncedSkuSignature]);

  // Real-time duplicate detection across the grade rows (trimmed, case-insensitive)
  const analyzeDuplicates = (values: string[]) => {
    const groups = new Map<string, { display: string; indices: number[] }>();
    values.forEach((value, index) => {
      const key = value.trim().toLowerCase();
      if (!key) return;
      const entry = groups.get(key) ?? { display: value.trim(), indices: [] };
      entry.indices.push(index);
      groups.set(key, entry);
    });
    const duplicatedIndices = new Set<number>();
    const duplicated = new Map<string, { display: string; indices: number[] }>();
    for (const [key, entry] of groups) {
      if (entry.indices.length > 1) {
        entry.indices.forEach((i) => duplicatedIndices.add(i));
        duplicated.set(key, entry);
      }
    }
    return { duplicatedIndices, duplicated };
  };
  const draftConflicts = useMemo(
    () => ({
      grades: analyzeDuplicates(gradeDrafts.map((draft) => draft.grade)),
      skus: analyzeDuplicates(gradeDrafts.map((draft) => draft.sku)),
    }),
    [gradeDrafts]
  );
  const hasDraftDuplicates = draftConflicts.grades.duplicatedIndices.size > 0 || draftConflicts.skus.duplicatedIndices.size > 0;

  // Drafts that collide with the catalogue — grades of the matched family + SKUs tenant-wide
  const draftCatalogueConflicts = useMemo(() => {
    const grades = new Set<number>();
    const skus = new Set<number>();
    if (existingCheckState === "ready") {
      gradeDrafts.forEach((draft, index) => {
        if (existingGrades.has(draft.grade.trim().toLowerCase())) grades.add(index);
      });
    }
    gradeDrafts.forEach((draft, index) => {
      const sku = draft.sku.trim().toLowerCase();
      if (sku && skuLookup.existing.has(sku)) skus.add(index);
    });
    return { grades, skus };
  }, [gradeDrafts, existingGrades, existingCheckState, skuLookup.existing]);
  const hasCatalogueConflicts = draftCatalogueConflicts.grades.size > 0 || draftCatalogueConflicts.skus.size > 0;
  const hasBlockingConflicts = hasDraftDuplicates || hasCatalogueConflicts;

  // Pick a suggestion: fill the form with the existing product's details + immediate SKU propose (no 250 ms wait)
  const selectFamilySuggestion = (family: FamilySummary) => {
    setFamilyForm((current) => ({
      ...current,
      name: family.name,
      description: family.description ?? current.description,
      manufacturer: family.manufacturer
        ? displayManufacturer(family.manufacturer)
        : current.manufacturer,
    }));
    skuFillFromServer(family.name); // immediate proposal — explicit pick is a commit
    setFamilySuggestOpen(false);
    setFamilySuggestIndex(-1);
    // Explicit dropdown selection = explicit commit — fetch the family's grade list NOW, no waiting
    if (lastFetchedFamilyRef.current !== family.name) loadFamilyCatalogue(family.name);
  };

  // Deactivated families modal: load inactive groups on demand
  const openDeactivated = async () => {
    setShowDeactivated(true);
    setDeactivatedLoading(true);
    setError("");
    try {
      const rows = await api.products.families("inactive");
      setDeactivatedFamilies(rows);
    } catch (err: any) {
      setError(err.message || "Could not load the deactivated families");
      setShowDeactivated(false);
    } finally {
      setDeactivatedLoading(false);
    }
  };

  // Reactivate one family — refreshes both the deactivated list and the live catalogue
  const handleReactivateFamily = async (name: string) => {
    if (reactivating) return;
    setReactivating(name);
    setError("");
    try {
      const result = await api.products.reactivateFamily(name);
      setNotice(result?.message ?? `"${name}" reactivated.`);
      try {
        setDeactivatedFamilies(await api.products.families("inactive"));
      } catch {
        setShowDeactivated(false);
      }
      void load();
    } catch (err: any) {
      setError(err.message || "Could not reactivate the product");
    } finally {
      setReactivating(null);
    }
  };

  // Close the suggestion list on outside clicks
  useEffect(() => {
    if (!familySuggestOpen) return undefined;
    const close = (event: globalThis.MouseEvent) => {
      if (familySuggestRef.current && !familySuggestRef.current.contains(event.target as Node)) {
        setFamilySuggestOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [familySuggestOpen]);

  const resetFamilyForm = () => {
    setFamilyForm({ name: "", description: "", manufacturer: "SELF (KLJ)" });
    setGradeDrafts([newGradeDraft()]);
    setFamilySuggestOpen(false);
    setFamilySuggestIndex(-1);
    setError("");
  };

  const openCreateProduct = () => {
    resetFamilyForm();
    setFamilyMode("create");
    setShowFamilyForm(true);
    setNotice("");
  };

  const openAddGrade = (family: FamilySummary) => {
    resetFamilyForm();
    setFamilyForm({
      name: family.name,
      description: family.description || "",
      manufacturer: displayManufacturer(family.manufacturer),
    });
    const draft = newGradeDraft();
    setGradeDrafts([draft]);
    setFamilyMode("add-grade");
    setShowFamilyForm(true);
    setNotice("");
    skuFillFromServer(family.name); // openAddGrade → propose next SKU immediately
  };

  const closeFamilyForm = () => {
    setShowFamilyForm(false);
    resetFamilyForm();
  };

  const addGradeDraft = async () => {
    const trimmed = familyForm.name.trim();
    const draft = newGradeDraft();
    if (trimmed) {
      try {
        const { sku } = await api.products.nextSku(trimmed);
        const base = parseSkuValue(sku);
        if (base) {
          // Continue past SKUs already drafted in this form (auto-filled ones aren't in the catalogue yet)
          const draftedMax = gradeDrafts.reduce((max, row) => {
            const cand = parseSkuValue(row.sku);
            return cand && cand.prefix === base.prefix ? Math.max(max, cand.nextSequence) : max;
          }, 0);
          const seq = Math.max(base.nextSequence, draftedMax + 1);
          draft.sku = `${base.prefix}-${String(seq).padStart(base.padLen, "0")}`;
        }
      } catch { /* offline — leave the SKU blank; the submit button stays blocked until it has one */ }
    }
    setGradeDrafts((current) => [...current, draft]);
  };

  const updateGradeDraft = (index: number, patch: Partial<GradeDraft>) => {
    setGradeDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft
      )
    );
  };

  const removeGradeDraft = (index: number) => {
    setGradeDrafts((current) =>
      current.length === 1 ? current : current.filter((_, i) => i !== index)
    );
  };

  const handleFamilySubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;

    const name = familyForm.name.trim();
    if (!name) {
      setError("Enter the product name");
      return;
    }
    if (hasBlockingConflicts) {
      setError("Fix the highlighted duplicate grade names / SKUs below before saving.");
      return;
    }

    const grades = gradeDrafts
      .map((draft) => ({
        grade: draft.grade.trim(),
        sku: draft.sku.trim(),
        bag_quantity_id: draft.bag_quantity_id || null,
      }))
      .filter((grade) => grade.grade && grade.sku);

    if (grades.length === 0) {
      setError("Add at least one grade with a grade name and SKU");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (familyMode === "create") {
        const result = await api.products.createFamily({
          name,
          description: familyForm.description.trim() || undefined,
          manufacturer: familyForm.manufacturer.trim() || undefined,
          grades: grades.map((grade) => ({ ...grade, bag_quantity_id: grade.bag_quantity_id || null })),
        });
        setNotice(result?.message || `${name} saved.`);
      } else {
        for (const grade of grades) {
          await api.products.create({
            name,
            description: familyForm.description.trim() || null,
            sku: grade.sku,
            quantity: 0,
            grade: grade.grade,
            bag_quantity_id: grade.bag_quantity_id || null,
            manufacturer: familyForm.manufacturer.trim() || null,
          });
        }
        setNotice(`${grades.length} grade${grades.length === 1 ? "" : "s"} added to ${name}.`);
      }
      closeFamilyForm();
      await load();
    } catch (err: any) {
      setError(err.message || "Could not save product");
    } finally {
      setSaving(false);
    }
  };

  const openRename = (family: FamilySummary) => {
    setRenameFamilyName(family.name);
    setRenameForm({ name: family.name, description: family.description || "" });
    setNotice("");
  };

  // Scenario 2 — empty family: act directly, no confirmation needed
  const runFamilyAction = async (family: FamilySummary, action: 'delete' | 'deactivate') => {
    if (confirmFamilyRunning) return;
    setConfirmFamilyRunning(true);
    setError("");
    try {
      if (action === 'delete') {
        const result = await api.products.deleteFamily(family.name);
        setNotice(result?.message || `"${family.name}" deleted.`);
      } else {
        const result = await api.products.deactivateFamily(family.name);
        setNotice(result?.message || `"${family.name}" deactivated.`);
      }
      setConfirmFamily(null);
      await load();
      setRefreshKey((key) => key + 1);
    } catch (err: any) {
      setError(err.message || (action === 'delete' ? 'Could not delete the product' : 'Could not deactivate the product'));
      setConfirmFamily(null);
    } finally {
      setConfirmFamilyRunning(false);
    }
  };

  const deleteFamily = async (family: FamilySummary) => {
    if (family.count <= 0) {
      await runFamilyAction(family, 'delete');
      return;
    }
    setConfirmFamily({ family, confirm: 'delete' });
  };

  const deactivateFamily = async (family: FamilySummary) => {
    if (family.count <= 0) {
      await runFamilyAction(family, 'deactivate');
      return;
    }
    setConfirmFamily({ family, confirm: 'deactivate' });
  };

  const handleRenameSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameFamilyName || saving) return;

    const currentName = renameFamilyName;
    const name = renameForm.name.trim();
    if (!name) {
      setError("Enter the new product name");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await api.products.renameFamily({
        currentName,
        name,
        description: renameForm.description.trim() || undefined,
      });
      setNotice(result?.message || `${currentName} renamed to ${name}.`);
      setRenameFamilyName(null);
      await load();
    } catch (err: any) {
      setError(err.message || "Could not rename the family");
    } finally {
      setSaving(false);
    }
  };

  const openEditGrade = (product: Product) => {
    setEditGrade(product);
    setGradeError("");
    setGradeForm({
      grade: product.grade || "",
      sku: product.sku || "",
      bag_quantity_id: product.bag_quantity_id ? String(product.bag_quantity_id) : "",
    });
    setNotice("");
  };

  const handleGradeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editGrade || saving) return;

    const grade = gradeForm.grade.trim();
    const sku = gradeForm.sku.trim();
    if (!grade || !sku) {
      setGradeError("Grade and SKU are required.");
      return;
    }

    setSaving(true);
    setGradeError("");
    try {
      await api.products.update(editGrade.id, {
        name: editGrade.name,
        description: editGrade.description || null,
        sku,
        quantity: editGrade.quantity || 0,
        grade,
        bag_quantity_id: gradeForm.bag_quantity_id || null,
        manufacturer: editGrade.manufacturer || null,
        hsn_code: (editGrade as any).hsn_code || null,
      });
      setNotice(`Grade "${grade}" saved.`);
      setEditGrade(null);
      await load();
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setGradeError(err.message || "Could not save the grade");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: Product) => {
    if (!window.confirm(`Delete grade "${product.grade || product.sku}" from ${product.name}?`)) {
      return;
    }
    try {
      await api.products.delete(product.id);
      setNotice("Product deleted");
      await load();
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setError(err.message || "Could not delete the product");
    }
  };

  // Search helper: show a flat result list via the capped search endpoint.
  const [searchHits, setSearchHits] = useState<Product[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    if (!isSearching) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    api.products
      .search(debouncedSearch.trim())
      .then((hits: Product[]) => {
        if (!cancelled) setSearchHits(hits || []);
      })
      .catch(() => {
        if (!cancelled) setSearchHits([]);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, isSearching]);

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
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
            <Package size={22} />
          </div>
          <div className="flex flex-col gap-1 max-w-xl">
            <h2 className="text-xl font-bold text-slate-900">Product catalogue</h2>
            <p className="mt-0.5 text-sm text-slate-500">
            One product can have many grades. </p>
            {canManage && <DivisionContextNote />}
            {/* Batches and sales use the grade.
            {isSearching
              ? ` Showing up to 100 matches for “${debouncedSearch.trim()}”.`
              : ` ${totalProducts.toLocaleString()} products across ${families.length.toLocaleString()} families.`}
            */}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void openDeactivated()}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-100"
              title="View and restore deactivated families"
            >
              <EyeOff size={16} />View Deactivated{deactivatedFamilies !== null && deactivatedFamilies.length > 0 ? ` (${deactivatedFamilies.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setShowImportWizard(true)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
              title="Download the template, fill it in, validate and import"
            >
              <Upload size={16} /> Import products
            </button>
            <button type="button" onClick={() => void load()} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={openCreateProduct} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-700">
              <Plus size={16} /> Add product
            </button>
          </div>
        )}
      </div>

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
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p role="status" className="text-sm font-semibold text-emerald-700">{notice}</p>
        </div>
      )}

      {!isSearching && familyTotal > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span>Show</span>
            <select
              aria-label="Product groups per page"
              value={familyPageSize}
              onChange={(event) => changePageSize(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span>per page · {familyTotal.toLocaleString()} groups total</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={familyPage <= 1}
              onClick={() => changePage(familyPage - 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            {pageButtons.map((page, index) =>
              typeof page === "number" ? (
                <button
                  key={`${page}-${index}`}
                  type="button"
                  aria-label={`Page ${page}`}
                  aria-current={page === familyPage ? "page" : undefined}
                  onClick={() => changePage(page)}
                  className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-bold transition-colors ${
                    page === familyPage
                      ? "bg-brand-600 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {page}
                </button>
              ) : (
                <span key={`gap-${index}`} className="px-1 text-xs text-slate-400">{page}</span>
              ),
            )}
            <button
              type="button"
              aria-label="Next page"
              disabled={familyPage >= familyPages}
              onClick={() => changePage(familyPage + 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
            <span className="ml-2 text-xs font-bold text-slate-500">
              Page {familyPage} of {familyPages}
            </span>
          </div>
        </div>
      )}

      {loading && familyTotal === 0 ? (
        <div className="rounded-2xl flex flex-col items-center gap-4 border-2 border-slate-200 bg-white p-12 text-center text-sm font-semibold text-slate-500">
          <LoaderCircle size={28} className="animate-spin"/>
          <span>
          Loading products...
          </span>
        </div>
      ) : isSearching ? (
        searchLoading ? (
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-500">Searching…</div>
        ) : searchHits.length === 0 ? (
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-12 text-center">
            <p className="text-base font-bold text-slate-700">No products found</p>
            <p className="mt-0.5 text-sm text-slate-500">Try a different search term.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-sm">
              <thead className="border-b-2 border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Grade</th>
                  <th className="px-5 py-3">SKU</th>
                  <th className="px-5 py-3">UOM</th>
                  <th className="px-5 py-3">Manufacturer</th>
                  {showDivisionBadges && <th className="px-5 py-3">Division</th>}
                  {canManage && <th className="px-5 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {searchHits.map((product) => (
                  <tr key={product.id} className="transition-colors hover:bg-slate-50/80">
                    <td className="px-5 py-3.5 font-bold text-slate-900">{product.name}</td>
                    <td className="px-5 py-3.5 font-medium text-slate-800">{product.grade}</td>
                    <td className="px-5 py-3.5"><span className="rounded border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-800">{product.sku}</span></td>
                    <td className="px-5 py-3.5"><span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">{uomLabel(uoms, bagQuantities, product.bag_quantity_id)}</span></td>
                    <td className="px-5 py-3.5 text-sm font-medium text-slate-700">{product.manufacturer}</td>
                    {showDivisionBadges && (
                      <td className="px-5 py-3.5">
                        <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700">
                          {product.division_id == null
                            ? "Shared (all divisions)"
                            : divisions.find((d) => String(d.id) === String(product.division_id))?.name || `Division ${product.division_id}`}
                        </span>
                      </td>
                    )}
                    {canManage && (
                      <td className="px-5 py-3.5 text-right">
                        <button type="button" onClick={() => openEditGrade(product)} className="mr-2 p-2 text-slate-500 hover:text-slate-800"><Pencil size={16} /></button>
                        <button type="button" onClick={() => void handleDelete(product)} className="p-2 text-slate-500 hover:text-rose-600"><Trash2 size={16} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : familyTotal === 0 ? (
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-12 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Package size={24} />
          </div>
          <p className="text-base font-bold text-slate-700">No products found</p>
          <p className="mt-0.5 text-sm text-slate-500">Add your first product and its grades to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFamilies.map((family) => {
            const key = family.name.toLowerCase();
            const open = expanded.has(key);
            return (
              <section
                key={key}
                className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xs"
              >
                <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    {/* <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                      <Package size={22} />
                    </div> */}
                    <div>
                      <h3 className="text-lg font-extrabold text-slate-900">{family.name}</h3>
                      {family.description && (
                        <p className="text-sm text-slate-500">{family.description}</p>
                      )}
                      <p className="mt-0.5 text-xs font-semibold text-slate-400">
                        {family.count.toLocaleString()} grade{family.count === 1 ? "" : "s"}
                      </p>
                      {showDivisionBadges &&
                        familyDivisionLabels(family, divisions).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {familyDivisionLabels(family, divisions).map((label) => (
                              <span
                                key={label}
                                className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700"
                              >
                                <Layers size={11} /> {label}
                              </span>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleFamily(family.name)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      {open ? "Hide grades" : "Show grades"}
                    </button>
                    {canManage && (
                      <>
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
                        <button
                          type="button"
                          onClick={() => void deactivateFamily(family)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-100"
                          title={family.count > 0 ? `Deactivate "${family.name}" and all ${family.count.toLocaleString()} grades — kept in the database, hidden from every screen` : `Deactivate empty "${family.name}"`}
                        >
                          <EyeOff size={16} /> Deactivate
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteFamily(family)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-100"
                          title={family.count > 0 ? `Delete "${family.name}" and all ${family.count.toLocaleString()} grades` : `Delete empty "${family.name}"`}
                        >
                          <Trash2 size={16} /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {open && (
                  <FamilyGradesPanel
                    familyName={family.name}
                    refreshKey={refreshKey}
                    canManage={canManage}
                    formatUom={(id) => uomLabel(uoms, bagQuantities, id)}
                    onEdit={openEditGrade}
                    onDelete={handleDelete}
                  />
                )}
              </section>
            );
          })}
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
                  <div ref={familySuggestRef} className="relative">
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      value={familyForm.name}
                      onChange={(event) => {
                        const value = event.target.value;
                        setFamilyForm((current) => ({ ...current, name: value }));
                        // Non-empty names are picked up by the settle effect below (250 ms quiet →
                        // fetch the server's next-free-sequence and fill untouched drafts).
                        // Empty name → reset identically-tracked refs and clear untouched drafts.
                        if (!value.trim()) {
                          skuFetchSeqRef.current += 1; // cancel any in-flight auto-fill
                          setGradeDrafts((current) => current.map((d) => (d.skuTouched ? d : { ...d, sku: "" })));
                        }
                        setFamilySuggestOpen(true);
                        setFamilySuggestIndex(-1);
                      }}
                      onFocus={() => {
                        if (familyMode === "create") {
                          setFamilySuggestOpen(true);
                          setFamilySuggestIndex(-1);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (familyMode !== "create") return;
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setFamilySuggestOpen(true);
                          setFamilySuggestIndex((current) => Math.min(familySuggestions.length - 1, current + 1));
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setFamilySuggestIndex((current) => Math.max(-1, current - 1));
                        } else if (event.key === "Enter" && familySuggestOpen && familySuggestIndex >= 0 && familySuggestIndex < familySuggestions.length) {
                          event.preventDefault();
                          selectFamilySuggestion(familySuggestions[familySuggestIndex]);
                        } else if (event.key === "Escape" && familySuggestOpen) {
                          event.preventDefault();
                          setFamilySuggestOpen(false);
                          setFamilySuggestIndex(-1);
                        }
                      }}
                      placeholder="e.g. XLPE COMPOUND"
                      required
                      autoFocus={familyMode === "create"}
                      disabled={familyMode === "add-grade"}
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={familyMode === "create" && familySuggestOpen}
                      aria-controls="family-suggest-listbox"
                      aria-autocomplete="list"
                      aria-activedescendant={familySuggestIndex >= 0 ? `family-suggest-${familySuggestIndex}` : undefined}
                    />
                    {familyMode === "create" && familySuggestOpen && familySuggestions.length > 0 && (
                      <ul id="family-suggest-listbox" role="listbox" aria-label="Existing products" className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                        {familySuggestions.map((family, index) => (
                          <li key={family.name} id={`family-suggest-${index}`} role="option" aria-selected={index === familySuggestIndex}>
                            <button
                              type="button"
                              onMouseDown={(event) => { event.preventDefault(); selectFamilySuggestion(family); }}
                              onMouseEnter={() => setFamilySuggestIndex(index)}
                              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${index === familySuggestIndex ? "bg-brand-50" : "hover:bg-slate-50"}`}
                            >
                              <span className="truncate font-semibold text-slate-800">{family.name}</span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{family.count.toLocaleString()} grades</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {familyMode === "create" && matchedFamily && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800"><Info size={12} className="shrink-0" /> &ldquo;{matchedFamily.name}&rdquo; already exists ({matchedFamily.count.toLocaleString()} grades) &mdash; your new grades will be added to it.</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                    Description (optional)
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={familyForm.description}
                    onChange={(event) => setFamilyForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Real cable compound powder for outer sheath"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                    Manufacturer
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={familyForm.manufacturer}
                    onChange={(event) => setFamilyForm((current) => ({ ...current, manufacturer: event.target.value }))}
                  >
                    <option value="SELF (KLJ)">SELF (KLJ)</option>
                    {manufacturers.map((vendor: any) => (
                      <option key={vendor.id} value={vendor.name}>{vendor.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                {/* <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-700">
                    Grades sold
                  </label>
                  <button
                    type="button"
                    onClick={() => void addGradeDraft()}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200"
                  >
                    <Plus size={14} /> Add grade
                  </button>
                </div> */}

                <div className="space-y-3">
                  {hasBlockingConflicts && (
                    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-800">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <div className="space-y-0.5">
                        {[...draftConflicts.grades.duplicated.entries()].map(([key, { display, indices }]) => (
                          <p key={`grade-${key}`}>Duplicate grade name &ldquo;{display}&rdquo; — in rows {indices.map((i) => i + 1).join(", ")}. Grades must be unique within a product.</p>
                        ))}
                        {[...draftConflicts.skus.duplicated.entries()].map(([key, { display, indices }]) => (
                          <p key={`sku-${key}`}>Duplicate SKU &ldquo;{display}&rdquo; — in rows {indices.map((i) => i + 1).join(", ")}.</p>
                        ))}
                        {[...new Set(gradeDrafts.filter((_, i) => draftCatalogueConflicts.grades.has(i)).map((draft) => draft.grade.trim()))].map((display) => (
                          <p key={`cat-grade-${display}`}>Grade &ldquo;{display}&rdquo; already exists in &ldquo;{matchedFamily?.name}&rdquo; — pick a different name.</p>
                        ))}
                        {[...new Set(gradeDrafts.filter((_, i) => draftCatalogueConflicts.skus.has(i)).map((draft) => draft.sku.trim()))].map((display) => (
                          <p key={`cat-sku-${display}`}>SKU &ldquo;{display}&rdquo; already exists in the catalogue.</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {(existingCheckState === "loading" || skuLookup.checking) && (
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500"><Loader2 size={11} className="animate-spin" /> Checking existing grades &amp; SKUs…</p>
                  )}
                  {existingCheckState === "error" && (
                    <p role="alert" className="text-[11px] font-semibold text-amber-800">Could not load existing grades — the server will reject duplicates on save.</p>
                  )}
                  {skuLookup.error && (
                    <p role="alert" className="text-[11px] font-semibold text-amber-800">Could not verify some SKUs — the server will reject duplicates on save.</p>
                  )}
                  {/* Column headers — shown once on desktop; each row keeps mini labels on mobile */}
                  <div className="hidden grid-cols-[1fr_1fr_110px_auto] gap-3 px-1 pb-1.5 sm:grid" aria-hidden="true">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Grade name <span className="text-rose-500">*</span></span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">SKU</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">UOM</span>
                    <span />
                  </div>
                  {gradeDrafts.map((draft, index) => {
                    const gradeDup = draftConflicts.grades.duplicated.get(draft.grade.trim().toLowerCase());
                    const skuDup = draftConflicts.skus.duplicated.get(draft.sku.trim().toLowerCase());
                    const gradeCatalogueDup = draftCatalogueConflicts.grades.has(index);
                    const skuCatalogueDup = draftCatalogueConflicts.skus.has(index);
                    const otherRows = (entry?: { indices: number[] }) => (entry ? entry.indices.filter((i) => i !== index).map((i) => i + 1).join(", ") : "");
                    const gradeInvalid = Boolean(gradeDup) || gradeCatalogueDup;
                    const skuInvalid = Boolean(skuDup) || skuCatalogueDup;
                    return (
                      <div key={draft.key} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_110px_auto] sm:gap-3">
                        <div>
                          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
                            Grade name <span className="text-rose-500">*</span>
                          </label>
                          <input
                            className={`w-full rounded-xl border px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 ${gradeInvalid ? "border-rose-400 bg-rose-50 text-rose-900 focus:ring-rose-500" : "border-slate-200 bg-white text-slate-900 focus:ring-brand-500"}`}
                            value={draft.grade}
                            onChange={(event) => updateGradeDraft(index, { grade: event.target.value })}
                            placeholder="e.g. XLPE BK 9406"
                            required
                            aria-invalid={gradeInvalid}
                          />
                          {hasBlockingConflicts && (
                            <p className={`mt-1 h-4 text-[11px] leading-4 font-semibold text-rose-700 ${gradeInvalid ? "" : "invisible"}`} aria-hidden={!gradeInvalid}>
                              {gradeInvalid ? (gradeDup ? `Duplicate in form — also in row ${otherRows(gradeDup)}` : `Already exists in "${matchedFamily?.name}"`) : ""}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
                            SKU
                          </label>
                          <input
                            className={`w-full rounded-xl border px-3 py-2.5 font-mono text-sm font-bold focus:outline-none focus:ring-2 ${skuInvalid ? "border-rose-400 bg-rose-50 text-rose-900 focus:ring-rose-500" : "border-slate-200 bg-white text-slate-900 focus:ring-brand-500"}`}
                            value={draft.sku}
                            onChange={(event) => updateGradeDraft(index, { sku: event.target.value, skuTouched: true })}
                            placeholder="KLJ-XXX-001"
                            required
                            aria-invalid={skuInvalid}
                          />
                          {hasBlockingConflicts && (
                            <p className={`mt-1 h-4 text-[11px] leading-4 font-semibold text-rose-700 ${skuInvalid ? "" : "invisible"}`} aria-hidden={!skuInvalid}>
                              {skuInvalid ? (skuDup ? `Duplicate in form — also in row ${otherRows(skuDup)}` : "Already exists in the catalogue") : ""}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:hidden">
                            UOM
                          </label>
                          <select
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                            value={draft.bag_quantity_id}
                            onChange={(event) => updateGradeDraft(index, { bag_quantity_id: event.target.value })}
                          >
                            <option value="">—</option>
                            {uoms.map((uom: any) => (
                              <option key={`uom-${uom.id}`} value={String(uom.id)}>{uom.name}</option>
                            ))}
                            {bagQuantities.map((bag: any) => (
                              <option key={`bag-${bag.id}`} value={String(bag.id)}>{bag.name}{bag.quantity ? ` (${bag.quantity})` : ""}</option>
                            ))}
                          </select>
                        </div>
                        {/* <div className="flex items-center gap-2"> */}
                          <button
                            type="button"
                            onClick={() => removeGradeDraft(index)}
                            className={`rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 ${hasBlockingConflicts ? "mb-[20px]" : "mb-0.5"}`}
                            disabled={gradeDrafts.length === 1}
                            aria-label="Remove grade"
                          >
                            <Trash2 size={16} />
                          </button>
                        {/* </div> */}
                      </div>
                    );
                  })}
                  <div className="w-fit ml-auto">

                    <button
                      type="button"
                      onClick={() => void addGradeDraft()}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-6 py-4 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 cursor-pointer"
                      >
                      <Plus size={14} /> Add More Grade
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={closeFamilyForm}
                  disabled={saving}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || hasBlockingConflicts}
                  title={hasBlockingConflicts ? "Fix the highlighted duplicate grades / SKUs first" : undefined}
                  className="btn-primary"
                >
                  {saving ? "Saving…" : familyMode === "create" ? "Create product" : "Add grade"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmFamily !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="family-action-title">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-rose-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-rose-100 bg-rose-50 p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                  {confirmFamily.confirm === 'delete' ? <Trash2 size={18} /> : <EyeOff size={18} />}
                </span>
                <div>
                  <h2 id="family-action-title" className="text-lg font-extrabold text-slate-900">
                    {confirmFamily.confirm === 'delete' ? 'Delete product' : 'Deactivate product'}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {confirmFamily.confirm === 'delete'
                      ? <>Delete <span className="font-bold text-slate-900">&ldquo;{confirmFamily.family.name}&rdquo;</span> and all of its{" "}<span className="font-bold text-rose-700">{confirmFamily.family.count.toLocaleString()} grade{confirmFamily.family.count === 1 ? "" : "s"}</span>?</>
                      : <>Deactivate <span className="font-bold text-slate-900">&ldquo;{confirmFamily.family.name}&rdquo;</span> and all of its{" "}<span className="font-bold text-amber-700">{confirmFamily.family.count.toLocaleString()} grade{confirmFamily.family.count === 1 ? "" : "s"}</span>?</>}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmFamily(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-slate-700"
                disabled={confirmFamilyRunning}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              {confirmFamily.confirm === 'delete' ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold leading-relaxed text-rose-900">
                  This cannot be undone. {confirmFamily.family.count.toLocaleString()} grade{confirmFamily.family.count === 1 ? "" : "s"} — and every batch, QR label, QC and dispatch record tied to them — will be permanently deleted.
                  {confirmFamily.family.count > 0 && (
                    <>
                      <br />
                      If any grade already has batches, the whole delete is refused and nothing is removed.
                    </>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-relaxed text-amber-900">
                  Deactivate, don&rsquo;t delete. All {confirmFamily.family.count.toLocaleString()} grade{confirmFamily.family.count === 1 ? "" : "s"} stay in the database with their batches, QR labels, QC and dispatch records, but the product disappears from the catalogue and from every screen — no new batches, orders or QC on it.
                  <br />
                  Deactivation is reversible later by the support team if needed.
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setConfirmFamily(null)}
                  disabled={confirmFamilyRunning}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                {confirmFamily.confirm === 'delete' && (
                  <button
                    type="button"
                    onClick={() => void runFamilyAction(confirmFamily.family, 'deactivate')}
                    disabled={confirmFamilyRunning}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60"
                  >
                    <EyeOff size={15} />
                    {confirmFamilyRunning ? 'Working…' : `Deactivate instead (${confirmFamily.family.count.toLocaleString()} grade${confirmFamily.family.count === 1 ? '' : 's'})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void runFamilyAction(confirmFamily.family, confirmFamily.confirm)}
                  disabled={confirmFamilyRunning}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-extrabold text-white transition-colors disabled:opacity-60 ${confirmFamily.confirm === 'delete' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                >
                  {confirmFamilyRunning ? <Loader2 size={16} className="animate-spin" /> : (confirmFamily.confirm === 'delete' ? <Trash2 size={16} /> : <EyeOff size={16} />)}
                  {confirmFamilyRunning
                    ? (confirmFamily.confirm === 'delete' ? 'Deleting…' : 'Deactivating…')
                    : (confirmFamily.confirm === 'delete'
                        ? `Delete product & ${confirmFamily.family.count.toLocaleString()} grade${confirmFamily.family.count === 1 ? '' : 's'}`
                        : `Deactivate product & ${confirmFamily.family.count.toLocaleString()} grade${confirmFamily.family.count === 1 ? '' : 's'}`)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {renameFamilyName !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Rename product</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Rename every grade of “{renameFamilyName}” at once.
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
                  New name *
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={renameForm.name}
                  onChange={(event) => setRenameForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. XLPE COMPOUND"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                  Description (optional)
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={renameForm.description}
                  onChange={(event) => setRenameForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Real cable compound powder"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setRenameFamilyName(null)}
                  disabled={saving}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? "Saving…" : "Save name"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editGrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Edit grade</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Grade of “{editGrade.name}”
                </p>
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
              {gradeError && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-semibold text-rose-700"
                >
                  {gradeError}
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                  Grade name *
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={gradeForm.grade}
                  onChange={(event) => {
                    setGradeError("");
                    setGradeForm((current) => ({ ...current, grade: event.target.value }));
                  }}
                  placeholder="e.g. XLPE BK 9406"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                  SKU *
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={gradeForm.sku}
                  onChange={(event) => {
                    setGradeError("");
                    setGradeForm((current) => ({ ...current, sku: event.target.value }));
                  }}
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-700">
                  UOM
                </label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={gradeForm.bag_quantity_id}
                  onChange={(event) => setGradeForm((current) => ({ ...current, bag_quantity_id: event.target.value }))}
                >
                  <option value="">—</option>
                  {uoms.map((uom: any) => (
                    <option key={`uom-${uom.id}`} value={String(uom.id)}>{uom.name}</option>
                  ))}
                  {bagQuantities.map((bag: any) => (
                    <option key={`bag-${bag.id}`} value={String(bag.id)}>{bag.name} {bag.quantity ? `(${bag.quantity})` : ""}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditGrade(null)}
                  disabled={saving}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? "Saving…" : "Save grade"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4-step import wizard modal */}
      {showImportWizard && canManage && (
        <ImportWizard
          onClose={() => setShowImportWizard(false)}
          onImported={() => { void load(); setNotice('Products imported successfully.'); }}
        />
      )}

      {/* Deactivated families — manage + reactivate */}
      {showDeactivated && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="deactivated-title">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border-2 border-amber-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <EyeOff size={20} />
                </span>
                <div>
                  <h2 id="deactivated-title" className="text-lg font-extrabold text-slate-900">Deactivated products</h2>
                  <p className="mt-0.5 text-xs text-slate-600">Records are kept but hidden from every screen. Reactivate to restore the family in the catalogue.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowDeactivated(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-amber-100 hover:text-slate-700" aria-label="Close"><X size={18} /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {deactivatedLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm font-semibold text-slate-500"><Loader2 size={18} className="animate-spin" /> Loading deactivated products…</div>
              ) : !deactivatedFamilies || deactivatedFamilies.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <EyeOff size={30} className="text-slate-300" />
                  <p className="text-sm font-bold text-slate-600">Nothing is deactivated right now</p>
                  <p className="max-w-[24rem] text-xs text-slate-500">Deactivating a product keeps its rows in the database, hidden from every screen. Use the Deactivate button on a family to hide it here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {deactivatedFamilies.map((family) => (
                    <li key={family.name} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">{family.name}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{family.count.toLocaleString()} grade{family.count === 1 ? "" : "s"} · hidden</p>
                        {family.description && <p className="mt-0.5 truncate text-[11px] text-slate-500">{family.description}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleReactivateFamily(family.name)}
                        disabled={reactivating !== null}
                        title={`Reactivate "${family.name}" and its ${family.count.toLocaleString()} grade${family.count === 1 ? "" : "s"}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-extrabold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {reactivating === family.name
                          ? <><Loader2 size={13} className="animate-spin" /> Restoring…</>
                          : <><Eye size={13} /> Reactivate</>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
              <p className="text-[10px] font-semibold text-slate-500">{deactivatedFamilies !== null && !deactivatedLoading ? `${deactivatedFamilies.length} deactivated ${deactivatedFamilies.length === 1 ? "family" : "families"}` : " "}</p>
              <button type="button" onClick={() => setShowDeactivated(false)} className="rounded-xl bg-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-300">Close</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
