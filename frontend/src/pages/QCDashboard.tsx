import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  RefreshCw,
  TrendingUp,
  UserCircle,
  Users,
  XCircle,
} from "lucide-react";
import { api } from "../services/api";

type QcPerson = {
  user_id: string;
  name: string;
  total: number;
  passed: number;
  failed: number;
  today: number;
  pass_rate: number;
};

export default function QCDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setStats(await api.qc.stats());
    } catch (err: any) {
      setError(err.message || "Could not load the QC dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const people: QcPerson[] = useMemo(
    () => (Array.isArray(stats?.perUser) ? stats.perUser : []),
    [stats],
  );

  const team = useMemo(
    () => ({
      pending: Number(stats?.pendingQc || 0),
      total: Number(stats?.totalTests || 0),
      passed: Number(stats?.passed || 0),
      failed: Number(stats?.failed || 0),
      passRate: Number(stats?.passRate || 0),
      today: Number(stats?.testsToday || 0),
      week: Number(stats?.testsThisWeek || 0),
    }),
    [stats],
  );

  return (
    <div className="page-container space-y-6">
      <header className="page-header">
        <div>
          <h1 className="page-title">QC Dashboard</h1>
          <p className="page-subtitle">
            How your QC team is performing, and what is waiting for review.
          </p>
        </div>
        <button
          className="btn-secondary btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />{" "}
          Refresh
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      {/* Team KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link to="/batches" className="card group p-5 hover:border-brand-300">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Clock size={18} />
            </span>
            <div>
              <p className="font-semibold text-surface-900">Waiting for QC</p>
              <p className="text-sm text-surface-500">
                {loading ? "Loading...." : `${team.pending} batches to review`}
              </p>
            </div>
          </div>
        </Link>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={18} />
            </span>
            <div>
              <p className="font-semibold text-surface-900">Passed</p>
              <p className="text-sm text-surface-500">
                {loading ? "Loading...." : `${team.passed} batches in stock`}
              </p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <XCircle size={18} />
            </span>
            <div>
              <p className="font-semibold text-surface-900">Failed</p>
              <p className="text-sm text-surface-500">
                {loading ? "Loading...." : `${team.failed} not added to stock`}
              </p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <TrendingUp size={18} />
            </span>
            <div>
              <p className="font-semibold text-surface-900">Pass rate</p>
              <p className="text-sm text-surface-500">
                {loading ? "Loading...." : `${team.passRate}% of ${team.total} reviews`}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Per-QC-person performance */}
      <section className="card overflow-hidden">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title flex items-center gap-2">
              <Users size={17} /> QC team performance
            </h2>
            <p className="mt-1 text-sm text-surface-500">
              How many batches each QC person has reviewed, and the result.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">
              {team.today} reviewed today
            </span>
            <span className="rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-700">
              {team.week} this week
            </span>
          </div>
        </div>
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-surface-400">
            <Loader2 size={18} className="mr-2 inline animate-spin" />
            Loading QC performance....
          </div>
        ) : people.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Users size={26} className="mx-auto text-surface-300" />
            <p className="mt-3 text-sm font-semibold text-surface-800">
              No QC reviews yet
            </p>
            <p className="mt-1 text-xs text-surface-500">
              Each person's numbers appear here once they mark their first
              batch.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>QC person</th>
                  <th>Today</th>
                  <th>Total reviewed</th>
                  <th>Passed</th>
                  <th>Failed</th>
                  <th>Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.user_id || person.name}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-[11px] font-extrabold text-brand-700">
                          {person.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="font-semibold text-surface-900">
                          {person.name}
                        </span>
                      </div>
                    </td>
                    <td className="font-semibold tabular-nums text-surface-800">
                      {person.today}
                    </td>
                    <td className="tabular-nums text-surface-700">{person.total}</td>
                    <td className="tabular-nums text-emerald-700">{person.passed}</td>
                    <td className="tabular-nums text-rose-600">{person.failed}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${person.pass_rate}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-surface-700">
                          {person.pass_rate}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Quick links */}
      <section className="grid gap-3 sm:grid-cols-2">
        <Link to="/batches" className="card group flex items-center gap-3 p-5 hover:border-brand-300">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <ClipboardCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-surface-900">Mark QC</p>
            <p className="text-sm text-surface-500">
              Review the waiting batches and mark each Pass or Fail.
            </p>
          </div>
        </Link>
        <Link
          to="/settings"
          className="card group flex items-center gap-3 p-5 hover:border-brand-300"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <UserCircle size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-surface-900">Settings</p>
            <p className="text-sm text-surface-500">
              Update your name, email and password.
            </p>
          </div>
        </Link>
      </section>
    </div>
  );
}
