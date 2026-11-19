import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import type { Division } from '../types';

/**
 * Inline hint shown inside ADMIN screens so it's always obvious which division
 * the current context is pinned to — the top-right switcher now decides BOTH
 * which rows you see and which division new rows are stamped with. Renders
 * nothing for non-admin users — their division is fixed by their account.
 */
export default function DivisionContextNote() {
  const { adminDivisionId, user } = useAuth();
  const [divisions, setDivisions] = useState<Division[]>([]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    let active = true;
    api.divisions.list()
      .then((list) => { if (active) setDivisions(list); })
      .catch(() => { if (active) setDivisions([]); });
    return () => { active = false; };
  }, [user?.role]);

  if (user?.role !== 'ADMIN') return null;

  const current = adminDivisionId === 'all'
    ? null
    : divisions.find((division) => String(division.id) === String(adminDivisionId)) ?? null;
  const label = adminDivisionId === 'all'
    ? 'All divisions (everything)'
    : (current?.name ?? '…');

  return (
    <div
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[11px] font-semibold text-brand-800"
      title="You see this division's data (plus shared rows) and new records are stamped with it. Change it from the division switcher at the top-right — pick 'All divisions' to see everything"
    >
      <Building2 size={13} className="shrink-0" />
      <span className="truncate">Viewing &amp; creating in: <span className="text-brand-900">{label}</span></span>
    </div>
  );
}
