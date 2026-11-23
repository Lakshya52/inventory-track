import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type MasterImportResult,
  type MasterImportValidation,
} from '../services/api';
import { EntityId } from '../types';
import { useAuth } from '../contexts/AuthContext';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Loader2,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';

type DivisionOption = { id: EntityId | string; name: string };
type ImportKind = 'products' | 'clients' | 'vendors' | 'users';

/**
 * One wizard for every master import. Products/grades are division-scoped;
 * clients and vendors are tenant-wide, so their flavor hides the division
 * picker and uses the simpler catalogue validation report.
 */
export default function ImportWizard({
  kind = 'products',
  onClose,
  onImported,
}: {
  kind?: ImportKind;
  onClose: () => void;
  onImported: () => void;
}) {
  const { adminDivisionId } = useAuth();
  const showDivision = kind === 'products';
  const entity = kind === 'products' ? 'product' : kind === 'clients' ? 'client' : kind === 'users' ? 'user' : 'vendor';
  const entityPlural = `${entity}s`;
  const importer = kind === 'products' ? api.products : kind === 'clients' ? api.clients : kind === 'users' ? api.users : api.vendors;
  const [divisions, setDivisions] = useState<DivisionOption[]>([]);
  const [divisionLoading, setDivisionLoading] = useState(true);
  // Default to the division the admin currently has selected at the top-right ('all' when none).
  const [selectedDivision, setSelectedDivision] = useState<string>(() => (adminDivisionId === 'all' ? 'all' : String(adminDivisionId)));
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const fileRef = useRef<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState('');
  const [result, setResult] = useState<MasterImportValidation | null>(null);
  const [confirmAllDivisions, setConfirmAllDivisions] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [applyResult, setApplyResult] = useState<MasterImportResult | null>(null);

  useEffect(() => {
    if (!showDivision) { setDivisionLoading(false); return; }
    let cancelled = false;
    setDivisionLoading(true);
    Promise.resolve(api.divisions.list())
      .then((list) => {
        if (cancelled) return;
        const options = list as DivisionOption[];
        setDivisions(options);
        // Stale stored division id (e.g. deleted division) — fall back to All divisions
        setSelectedDivision((current) => (current === 'all' || options.some((d) => String(d.id) === current) ? current : 'all'));
      })
      .catch(() => { if (!cancelled) setDivisions([]); })
      .finally(() => { if (!cancelled) setDivisionLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const noDivisionCount = result?.summary.noDivision ?? 0;
  const totalErrors = result?.summary.errors ?? 0;
  const selectedDivisionName = selectedDivision === 'all' ? null : divisions.find((d) => String(d.id) === selectedDivision)?.name ?? null;

  const issueRows = useMemo(() => (result ? result.rows.filter((row) => row.errors.length || row.warnings.length) : []), [result]);

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      const blob = showDivision
        ? await api.products.importTemplate(selectedDivision === 'all' ? 'all' : selectedDivision)
        : await importer.importTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}-import.xlsx`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setDownloadError(err.message || 'Could not download the template');
    } finally {
      setDownloading(false);
    }
  };

  const resetFile = () => {
    fileRef.current = null;
    setFileName('');
    setResult(null);
    setValidateError('');
    setApplyError('');
    setApplyResult(null);
    setConfirmAllDivisions(false);
  };

  const handleFilePicked = async (file: File) => {
    fileRef.current = file;
    setFileName(file.name);
    setValidateError('');
    setApplyError('');
    setApplyResult(null);
    setResult(null);
    setConfirmAllDivisions(false);
    setValidating(true);
    try {
      const validation = await importer.importValidate(file);
      // The products response omits the vendor-only counters; the shared type
      // keeps them required so the report can read them without narrowing.
      setResult(validation as MasterImportValidation);
    } catch (err: any) {
      setValidateError(err.message || 'Could not read the file');
    } finally {
      setValidating(false);
    }
  };

  const handleApply = async () => {
    if (!fileRef.current || !result) return;
    setApplying(true);
    setApplyError('');
    try {
      const applied = await importer.importApply(fileRef.current);
      setApplyResult(applied);
    } catch (err: any) {
      setApplyError(err.message || 'Import failed');
    } finally {
      setApplying(false);
    }
  };

  const canApply = Boolean(result) && totalErrors === 0 && (noDivisionCount === 0 || confirmAllDivisions) && !applying;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 id="import-title" className="flex items-center gap-2 text-base font-extrabold tracking-tight text-slate-900">
            <FileSpreadsheet size={18} className="text-brand-700" /> Import {kind === 'products' ? 'products & grades' : entityPlural}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Division picker (products only) + template download */}
          <div>
            {showDivision && (
              <>
                <label htmlFor="import-division" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Division</label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <select
                      id="import-division"
                      value={selectedDivision}
                      disabled={divisionLoading}
                      onChange={(event) => setSelectedDivision(event.target.value)}
                      className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                    >
                      <option value="all">All divisions</option>
                      {divisions.map((division) => (
                        <option key={division.id} value={String(division.id)}>{division.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDownloadTemplate()}
                    disabled={downloading}
                    title="Download the Excel template with instructions and examples"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-60"
                  >
                    {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {downloading ? 'Building…' : 'Download template'}
                  </button>
                </div>
              </>
            )}
            {!showDivision && (
              <button
                type="button"
                onClick={() => void handleDownloadTemplate()}
                disabled={downloading}
                title="Download the Excel template with instructions and examples"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-60"
              >
                {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {downloading ? 'Building…' : 'Download template'}
              </button>
            )}
            {downloadError && <p role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">{downloadError}</p>}
          </div>

          <div className="border-t border-slate-100" />

          {/* Upload / validate / confirm */}
          {!result && !applyResult && (
            <label
              htmlFor="import-file-input"
              className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40"
            >
              {validating ? (
                <>
                  <Loader2 size={26} className="animate-spin text-brand-600" />
                  <p className="text-sm font-bold text-slate-700">Checking {fileName}…</p>
                </>
              ) : (
                <>
                  <Upload size={26} className="text-slate-400" />
                  <p className="text-sm font-bold text-slate-700">Click to upload Excel file</p>
                  <p className="text-xs text-slate-400">.xlsx format · checked before anything is imported</p>
                </>
              )}
              <input
                id="import-file-input"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={validating}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void handleFilePicked(file);
                }}
              />
            </label>
          )}

          {validateError && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-rose-700">{validateError}</p>
              <button type="button" onClick={resetFile} className="shrink-0 text-xs font-bold text-rose-800 underline">Choose another file</button>
            </div>
          )}

          {result && !applyResult && (
            <div className="space-y-3">
              {/* Summary line */}
              <div className="flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-800">
                  <FileSpreadsheet size={16} className="shrink-0 text-slate-400" />
                  <span className="truncate">{fileName}</span>
                </p>
                <button type="button" onClick={resetFile} className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-slate-500 hover:text-rose-600"><Trash2 size={13} /> Change file</button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-slate-600">{result.summary.total.toLocaleString()} rows</span>
                {result.summary.valid > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700"><CheckCircle2 size={11} />{result.summary.valid.toLocaleString()} ready</span>}
                {kind === 'users' && (result.summary.qcCount ?? 0) > 0 && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700">{result.summary.qcCount} QC</span>}
                {kind === 'users' && (result.summary.dispatchCount ?? 0) > 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">{result.summary.dispatchCount} Dispatch</span>}
                {showDivision && result.summary.defaults > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800"><AlertTriangle size={11} />{result.summary.defaults.toLocaleString()} using defaults</span>}
                {showDivision && result.summary.missingUom > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800"><AlertTriangle size={11} />{result.summary.missingUom.toLocaleString()} without UOM</span>}
                {!showDivision && result.summary.missingCode > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800"><AlertTriangle size={11} />{result.summary.missingCode.toLocaleString()} auto-coded</span>}
                {totalErrors > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-700"><XCircle size={11} />{totalErrors} errors</span>}
                {result.summary.duplicatesInFile > 0 && <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-800">{result.summary.duplicatesInFile} dup in file</span>}
                {result.summary.duplicatesInDb > 0 && <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-800">{result.summary.duplicatesInDb} dup in catalogue</span>}
              </div>

              {/* Combined defaults notice — one line for the whole file, not one per row */}
              {(result.summary.defaults > 0 || result.summary.missingUom > 0 || result.summary.missingCode > 0) && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    {result.summary.missingSku > 0 && <><b>{result.summary.missingSku.toLocaleString()} row{result.summary.missingSku === 1 ? '' : 's'}</b> without SKU will be auto-generated (KLJ-&lt;NAME&gt;-NNN).{' '}</>}
                    {result.summary.missingManufacturer > 0 && <><b>{result.summary.missingManufacturer.toLocaleString()} row{result.summary.missingManufacturer === 1 ? '' : 's'}</b> without Manufacturer will be saved as <b>SELF (KLJ)</b>.{' '}</>}
                    {result.summary.missingUom > 0 && <><b>{result.summary.missingUom.toLocaleString()} row{result.summary.missingUom === 1 ? '' : 's'}</b> without UOM will be saved without UOM.{' '}</>}
                    {result.summary.missingCode > 0 && <><b>{result.summary.missingCode.toLocaleString()} vendor{result.summary.missingCode === 1 ? '' : 's'}</b> without a Vendor code will get an auto-generated VND-XXXXXX.{' '}</>}
                    {' '}Nothing to fix — expected when the columns are left blank.
                  </span>
                </div>
              )}

              {/* Issue list (only rows that need attention) */}
              {issueRows.length > 0 ? (
                <div className="max-h-44 overflow-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <tr><th className="px-2.5 py-1.5">Row</th><th className="px-2.5 py-1.5">{showDivision ? 'Product / Grade' : entity}</th><th className="px-2.5 py-1.5">Finding</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {issueRows.map((row) => (
                        <tr key={row.row} className={row.errors.length ? 'bg-rose-50/50' : ''}>
                          <td className="px-2.5 py-1.5 font-mono font-bold text-slate-500">{row.row}</td>
                          <td className="px-2.5 py-1.5">
                            {showDivision ? (
                              <><span className="font-bold text-slate-800">{row.product || '(missing)'}</span><span className="text-slate-500">{row.grade ? ` — ${row.grade}` : ''}</span></>
                            ) : (
                              <><span className="font-bold text-slate-800">{row.label || '(missing)'}</span><span className="text-slate-500">{row.code ? ` — ${row.code}` : ''}</span></>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {row.errors.map((err) => <span key={err} className="block font-semibold text-rose-700">{err}</span>)}
                            {row.warnings.map((warn) => <span key={warn} className="block text-amber-800">{warn}</span>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> All {result.summary.total.toLocaleString()} rows ready to import{kind === 'users' ? ` — ${result.summary.qcCount ?? 0} QC, ${result.summary.dispatchCount ?? 0} Dispatch` : showDivision ? ' — defaults will apply where blank' : ''}.</p>
              )}

              {/* All-divisions confirmation */}
              {showDivision && noDivisionCount > 0 && (
                <label className="flex cursor-pointer select-none items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-amber-600" checked={confirmAllDivisions} onChange={(event) => setConfirmAllDivisions(event.target.checked)} />
                  {noDivisionCount} row{noDivisionCount === 1 ? '' : 's'} have no division and will be visible in EVERY division. I understand.
                </label>
              )}

              {applyError && <p role="alert" className="text-xs font-semibold text-rose-600">{applyError}</p>}

              <div className="flex items-center justify-end gap-2">
                {totalErrors > 0 && <p className="mr-auto text-[11px] font-semibold text-rose-600">Fix the red rows in the file and re-upload</p>}
                <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
                <button
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={!canApply}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {applying ? 'Importing…' : `Import ${(result.summary.valid).toLocaleString()} row${result.summary.valid === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          )}

          {applyResult && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100"><CheckCircle2 size={30} className="text-emerald-600" /></div>
              <p className="text-sm font-bold text-slate-800">{applyResult.imported} {entityPlural} imported</p>
              {applyResult.failed.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-left text-xs text-rose-800">
                  <p className="font-bold">{applyResult.failed.length} row{applyResult.failed.length === 1 ? '' : 's'} could not be written:</p>
                  <ul className="mt-1 max-h-24 overflow-auto">{applyResult.failed.map((f) => <li key={f.row}>Row {f.row}: {f.message}</li>)}</ul>
                </div>
              )}
              <button type="button" onClick={() => { onImported(); onClose(); }} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2 text-xs font-bold text-white hover:bg-brand-700">View {entityPlural}</button>
            </div>
          )}

          {!applyResult && (
            <p className="text-center text-[10px] font-medium text-slate-400">
              {kind === 'users'
                ? 'Only QC and DISPATCH can be imported · Division is optional (blank = no division) · passwords are stored as a hash'
                : showDivision
                  ? (selectedDivisionName ? `Every row imports into ${selectedDivisionName} · SKU blank = auto-generated` : 'Division blank = shared with every division · SKU blank = auto-generated')
                  : `Every row is shared across all divisions of your organisation${kind === 'vendors' ? ' · Vendor code blank = auto-generated' : ''}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
