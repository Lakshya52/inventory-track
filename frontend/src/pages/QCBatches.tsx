import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Package,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { api } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type BatchLine = {
  key: string;
  product_name: string;
  product_sku: string;
  package_quantity: number | string | null;
  uom: string;
  quantity: number;
  warehouse_name: string | null;
  locations: string[];
};

type ReviewGroup = {
  id: string;
  group_key: string;
  batch_number: string;
  status: string;
  created_at: string | null;
  created_by_name: string | null;
  units: number;
  product_lines: BatchLine[];
};

type ReviewFilter = "PENDING" | "ALL" | "PASSED" | "FAILED";
type Decision = { group: ReviewGroup; result: "PASS" | "FAIL" };

const statusMeta: Record<string, { label: string; className: string }> = {
  PENDING_QC: { label: "Waiting for QC", className: "badge badge-warning" },
  QC_PASSED: { label: "QC Passed", className: "badge badge-success" },
  QC_FAILED: { label: "QC Failed", className: "badge badge-danger" },
  DISPATCH_ORDER_RAISED: { label: "Order Raised", className: "badge badge-info" },
  DISPATCH_APPROVED: { label: "Ready to Load", className: "badge badge-info" },
  LOADING: { label: "Loading", className: "badge badge-info" },
  DISPATCHED: { label: "Dispatched", className: "badge badge-success" },
};

function statusInfo(status: string) {
  return (
    statusMeta[status] || {
      label: String(status || "Unknown").replace(/_/g, " "),
      className: "badge badge-info",
    }
  );
}

function groupBatches(batches: any[]): ReviewGroup[] {
  const groups = new Map<string, any>();
  for (const batch of batches) {
    const key = batch.batch_group_id
      ? `group:${batch.batch_group_id}`
      : `batch:${batch.id}`;
    const group =
      groups.get(key) ||
      {
        id: batch.batch_group_id || String(batch.id),
        group_key: key,
        batch_number: batch.parent_batch_number || batch.batch_number,
        status: batch.status || "PENDING_QC",
        created_at: batch.created_at || null,
        created_by_name: batch.created_by_name || null,
        units: 0,
        product_lines: new Map<string, any>(),
      };

    if (
      batch.created_at &&
      (!group.created_at ||
        new Date(batch.created_at).getTime() <
          new Date(group.created_at).getTime())
    ) {
      group.created_at = batch.created_at;
    }

    const productKey = String(batch.product_id);
    const line =
      group.product_lines.get(productKey) ||
      {
        key: productKey,
        product_name: batch.product_name || "Product",
        product_sku: batch.product_sku || "",
        package_quantity: batch.package_quantity ?? null,
        uom: batch.uom || "",
        quantity: 0,
        warehouse_name: batch.warehouse_name || null,
        locations: new Set<string>(),
      };

    line.quantity += Number(batch.quantity || 0);
    const location = batch.location_code || batch.storage_location;
    if (location) line.locations.add(String(location));
    group.product_lines.set(productKey, line);
    group.units += Number(batch.quantity || 0);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    product_lines: [...group.product_lines.values()].map((line: any) => ({
      ...line,
      locations: [...line.locations],
    })),
  }));
}

export default function QCBatches() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [filter, setFilter] = useState<ReviewFilter>("PENDING");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [remarks, setRemarks] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [bulkPassing, setBulkPassing] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const rows = await api.batches.list();
      setBatches(rows);
    } catch (err: any) {
      setError(err.message || "Could not load QC review batches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupBatches(batches), [batches]);

  const counts = useMemo(() => {
    let pending = 0;
    let pendingUnits = 0;
    let passed = 0;
    let failed = 0;
    for (const group of groups) {
      if (group.status === "PENDING_QC") {
        pending += 1;
        pendingUnits += group.units;
      }
      if (group.status === "QC_PASSED") passed += 1;
      if (group.status === "QC_FAILED") failed += 1;
    }
    return { pending, pendingUnits, passed, failed, all: groups.length };
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return groups
      .filter((group) => {
        if (filter === "PENDING" && group.status !== "PENDING_QC")
          return false;
        if (filter === "PASSED" && group.status !== "QC_PASSED")
          return false;
        if (filter === "FAILED" && group.status !== "QC_FAILED")
          return false;
        if (!query) return true;
        return (
          String(group.batch_number || "")
            .toLowerCase()
            .includes(query) ||
          group.product_lines.some(
            (line) =>
              line.product_name.toLowerCase().includes(query) ||
              line.product_sku.toLowerCase().includes(query),
          )
        );
      })
      .sort((a, b) => {
        const aPending = a.status === "PENDING_QC" ? 0 : 1;
        const bPending = b.status === "PENDING_QC" ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return aPending === 0 ? aTime - bTime : bTime - aTime;
      });
  }, [groups, filter, debouncedSearch]);

  const openDecision = (group: ReviewGroup, result: "PASS" | "FAIL") => {
    setDecision({ group, result });
    setRemarks("");
    setDecisionError("");
    setError("");
    setNotice("");
  };

  const closeDecision = () => {
    if (saving) return;
    setDecision(null);
    setDecisionError("");
    setRemarks("");
  };

  const submitDecision = async () => {
    if (!decision || saving) return;
    setSaving(true);
    setDecisionError("");
    try {
      const result = await api.qc.decideBatchGroup(decision.group.id, {
        result: decision.result,
        remarks: remarks.trim() || undefined,
      });
      setNotice(result.message);
      setDecision(null);
      setRemarks("");
      await load();
    } catch (err: any) {
      setDecisionError(err.message || "Could not save the QC decision");
    } finally {
      setSaving(false);
    }
  };

  const filterOptions: Array<{
    value: ReviewFilter;
    label: string;
    count: number;
  }> = [
    { value: "PENDING", label: "Waiting for QC", count: counts.pending },
    { value: "PASSED", label: "Passed", count: counts.passed },
    { value: "FAILED", label: "Failed", count: counts.failed },
    { value: "ALL", label: "All batches", count: counts.all },
  ];

  const pendingGroups = useMemo(
    () => filteredGroups.filter((group) => group.status === "PENDING_QC"),
    [filteredGroups],
  );
  const selectableIds = useMemo(
    () => pendingGroups.map((group) => group.id),
    [pendingGroups],
  );
  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };
  const toggleAllSelectable = () => {
    setSelectedGroupIds((current) =>
      selectableIds.length > 0 && selectableIds.every((id) => current.includes(id))
        ? []
        : selectableIds,
    );
  };
  const bulkPass = async () => {
    if (selectedGroupIds.length === 0 || bulkPassing) return;
    const count = selectedGroupIds.length;
    if (
      !window.confirm(
        `Pass ${count} batch${count === 1 ? "" : "es"}? Each batch is passed on its own and added to available stock.`,
      )
    ) {
      return;
    }
    setBulkPassing(true);
    setError("");
    setNotice("");
    try {
      const result = await api.qc.decideBatchGroupsBulk(
        selectedGroupIds,
        "Bulk pass of batches waiting for QC",
      );
      setSelectedGroupIds([]);
      setNotice(result.message);
      await load();
    } catch (err: any) {
      setError(err.message || "Could not pass the selected batches");
    } finally {
      setBulkPassing(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm sm:p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <ClipboardCheck size={25} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              Mark QC
            </h1>
            <p className="mt-1 text-sm text-slate-500 sm:text-base">
              Review batches created by Dispatch and mark each one Pass or
              Fail. Stock is added only when a batch passes.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm shrink-0"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            className="shrink-0 text-emerald-700 hover:text-emerald-900"
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Waiting for QC",
            value: counts.pending,
            sub: `${counts.pendingUnits.toLocaleString()} units`,
            icon: Clock,
            style: "bg-amber-50 text-amber-700",
          },
          {
            label: "Passed batches",
            value: counts.passed,
            sub: "Stock available",
            icon: CheckCircle2,
            style: "bg-emerald-50 text-emerald-700",
          },
          {
            label: "Failed batches",
            value: counts.failed,
            sub: "Stock not added",
            icon: AlertTriangle,
            style: "bg-rose-50 text-rose-700",
          },
          {
            label: "All batches",
            value: counts.all,
            sub: "Full history",
            icon: Package,
            style: "bg-sky-50 text-sky-700",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.style}`}
              >
                <card.icon size={19} />
              </span>
              <span className="text-3xl font-extrabold tabular-nums text-slate-900">
                {loading ? "—" : card.value}
              </span>
            </div>
            <p className="mt-3 text-sm font-bold text-slate-700">
              {card.label}
            </p>
            <p className="text-xs font-medium text-slate-500">{card.sub}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50/80 px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900">
              Review queue
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Oldest batches are shown first so nothing waits too long.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1.5">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={`rounded-lg px-3 py-2 text-xs font-extrabold transition-colors ${
                    filter === option.value
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {option.label}
                  <span
                    className={`ml-1.5 rounded-md px-1.5 py-0.5 text-[11px] ${
                      filter === option.value
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {option.count}
                  </span>
                </button>
              ))}
            </div>
            <label className="relative block w-full sm:w-64">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                className="input pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search batch, product or SKU"
                aria-label="Search QC batches"
              />
            </label>
          </div>
        </div>

        {pendingGroups.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3 sm:px-6">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={
                  selectableIds.length > 0 &&
                  selectableIds.every((id) => selectedGroupIds.includes(id))
                }
                onChange={toggleAllSelectable}
                aria-label="Select all batches waiting for QC"
              />
              Select all {selectableIds.length} batch
              {selectableIds.length === 1 ? "" : "es"}
            </label>
            {selectedGroupIds.length > 0 && (
              <button
                type="button"
                onClick={() => void bulkPass()}
                disabled={bulkPassing}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {bulkPassing ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                {bulkPassing
                  ? "Passing..."
                  : `Pass ${selectedGroupIds.length} selected`}
              </button>
            )}
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {filteredGroups.map((group) => {
            const status = statusInfo(group.status);
            const pending = group.status === "PENDING_QC";
            return (
              <article key={group.group_key} className="p-5 sm:p-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {pending && (
                        <label className="flex items-center gap-2" title="Select this batch for bulk pass">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300"
                            checked={selectedGroupIds.includes(group.id)}
                            onChange={() => toggleGroupSelection(group.id)}
                            aria-label={`Select batch ${group.batch_number} for bulk pass`}
                          />
                        </label>
                      )}
                      <span className="font-mono text-sm font-extrabold text-slate-900">
                        {group.batch_number}
                      </span>
                      <span className={status.className}>{status.label}</span>
                      {group.created_by_name && (
                        <span className="text-xs font-medium text-slate-500">
                          by {group.created_by_name}
                        </span>
                      )}
                      <span className="text-xs font-medium text-slate-500">
                        {group.created_at
                          ? new Date(group.created_at).toLocaleString()
                          : "Date not recorded"}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2">
                      {group.product_lines.map((line) => (
                        <div
                          key={line.key}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                        >
                          <span className="font-bold text-slate-900">
                            {line.product_name}
                          </span>
                          <span className="font-mono text-xs text-slate-500">
                            {line.product_sku}
                          </span>
                          <span className="font-semibold text-slate-600">
                            {line.package_quantity
                              ? `${line.package_quantity} ${line.uom} × `
                              : ""}
                            {line.quantity}{" "}
                            {line.quantity === 1 ? "unit" : "units"}
                          </span>
                          <span className="text-xs text-slate-500">
                            {line.warehouse_name || "Godown not set"}
                            {line.locations.length > 0
                              ? ` · ${line.locations.join(", ")}`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-3 xl:items-end">
                    <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-800">
                      {group.units.toLocaleString()}{" "}
                      {group.units === 1 ? "unit" : "units"} in batch
                    </div>
                    {pending ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openDecision(group, "PASS")}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                        >
                          <CheckCircle2 size={17} /> Pass batch
                        </button>
                        <button
                          type="button"
                          onClick={() => openDecision(group, "FAIL")}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
                        >
                          <XCircle size={17} /> Fail batch
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-slate-500">
                        Reviewed — no further action
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {!loading && filteredGroups.length === 0 && (
            <div className="px-6 py-12 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={22} />
              </span>
              <p className="mt-3 text-base font-bold text-slate-800">
                {debouncedSearch
                  ? "No batches match your search"
                  : filter === "PENDING"
                    ? "No batches waiting for QC"
                    : "No batches in this view"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {debouncedSearch
                  ? "Try another batch number, product name, or SKU."
                  : filter === "PENDING"
                    ? "Dispatch will send new batches here for review."
                    : "Switch to another filter to see more batches."}
              </p>
            </div>
          )}
          {loading && (
            <div className="px-6 py-12 text-center text-sm font-medium text-slate-400">
              Loading QC review batches…
            </div>
          )}
        </div>
      </section>

      {decision && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDecision();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qc-decision-title"
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    decision.result === "PASS"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {decision.result === "PASS" ? (
                    <CheckCircle2 size={22} />
                  ) : (
                    <XCircle size={22} />
                  )}
                </span>
                <div>
                  <h2
                    id="qc-decision-title"
                    className="text-xl font-extrabold text-slate-900"
                  >
                    {decision.result === "PASS"
                      ? "Pass this batch?"
                      : "Fail this batch?"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Batch{" "}
                    <span className="font-mono font-bold text-slate-700">
                      {decision.group.batch_number}
                    </span>{" "}
                    · {decision.group.units.toLocaleString()}{" "}
                    {decision.group.units === 1 ? "unit" : "units"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDecision}
                disabled={saving}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close QC decision"
              >
                <X size={18} />
              </button>
            </div>

            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-medium text-slate-600">
              {decision.result === "PASS"
                ? "Passing adds this batch to available stock and lets Dispatch use it in dispatch orders."
                : "Failing keeps this batch out of stock. It will not be available for dispatch."}
            </p>

            <label className="mt-4 block">
              <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
                Remarks (optional)
              </span>
              <textarea
                className="input mt-1.5 min-h-24 w-full resize-y"
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                maxLength={1000}
                placeholder={
                  decision.result === "PASS"
                    ? "Example: Quality checked and approved."
                    : "Example: Bag weight below standard."
                }
              />
            </label>

            {decisionError && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700"
              >
                {decisionError}
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDecision}
                disabled={saving}
                className="btn-secondary justify-center"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitDecision()}
                disabled={saving}
                className={`inline-flex justify-center rounded-xl px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition disabled:opacity-60 ${
                  decision.result === "PASS"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {saving
                  ? "Saving decision…"
                  : decision.result === "PASS"
                    ? "Confirm pass"
                    : "Confirm fail"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
