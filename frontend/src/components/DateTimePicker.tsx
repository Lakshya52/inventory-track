import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * A field that opens a full calendar + time popup when clicked anywhere,
 * instead of the cramped native datetime-local picker. The value keeps the
 * same "YYYY-MM-DDTHH:mm" shape the form already uses.
 */
export default function DateTimePicker({
	id,
	value,
	onChange,
	required,
	placeholder = "Pick the date and time",
}: {
	id?: string;
	value: string;
	onChange: (next: string) => void;
	required?: boolean;
	placeholder?: string;
}) {
	const [open, setOpen] = useState(false);
	const dialogRef = useRef<HTMLDivElement>(null);
	const generatedId = useId();
	const fieldId = id ?? generatedId;

	// Parse the stored value into parts; fall back to a sensible default view.
	const parsed = useMemo(() => {
		const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
		if (!match) return null;
		const [, y, m, d, hh, mm] = match.map(Number);
		return {
			year: match ? Number(y) : 0,
			month: match ? Number(m) - 1 : 0,
			day: match ? Number(d) : 1,
			hour: Number(hh),
			minute: Number(mm),
		};
	}, [value]);

	const [view, setView] = useState(() => {
		const base = parsed ?? (() => {
			const now = new Date();
			return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate(), hour: now.getHours(), minute: now.getMinutes() };
		})();
		return { year: base.year, month: base.month };
	});

	// Keep the calendar view following externally-set values.
	useEffect(() => {
		if (parsed) setView({ year: parsed.year, month: parsed.month });
	}, [parsed?.year, parsed?.month, parsed?.day, parsed?.hour, parsed?.minute]); // eslint-disable-line react-hooks/exhaustive-deps

	// Modal behaviour: Escape closes, background scroll is locked while open,
	// and the dialog gets focus so keyboard users land somewhere sensible.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		dialogRef.current?.focus();
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const weeks = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month]);

	function shiftMonth(delta: number) {
		setView((currentView) => {
			const next = new Date(currentView.year, currentView.month + delta, 1);
			return { year: next.getFullYear(), month: next.getMonth() };
		});
	}

	const emit = (next: { year: number; month: number; day: number; hour: number; minute: number }) => {
		onChange(formatValue(next));
	};

	const current = parsed ?? defaultPartsNow();
	const patch = (part: Partial<typeof current>) => emit({ ...current, ...part });

	const today = new Date();

	const label = parsed
		? formatDisplay(parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute)
		: placeholder;

	return (
		<>
			<button
				id={fieldId}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-required={required}
				onClick={() => setOpen(true)}
				className={`input flex h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 text-left text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 ${parsed ? "" : "text-slate-400"}`}
			>
				<span className="truncate">{label}</span>
				<CalendarDays size={18} className="shrink-0 text-brand-600" />
			</button>

			{open && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
					onMouseDown={() => setOpen(false)}
				>
					<div
						ref={dialogRef}
						tabIndex={-1}
						role="dialog"
						aria-modal="true"
						aria-label="Choose dispatch date and time"
						className="w-[400px] max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none"
						onMouseDown={(event) => event.stopPropagation()}
					>
					{/* Header */}
					<div className="flex items-center justify-between border-b border-slate-100 bg-surface-50 px-4 py-3">
						<button
							type="button"
							className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-200"
							aria-label="Previous month"
							onClick={() => shiftMonth(-1)}
						>
							<ChevronLeft size={17} />
						</button>
						<span className="text-sm font-bold text-slate-800">
							{new Date(view.year, view.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
						</span>
						<button
							type="button"
							className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-200"
							aria-label="Next month"
							onClick={() => shiftMonth(1)}
						>
							<ChevronRight size={17} />
						</button>
					</div>

					{/* Weekday header */}
					<div className="grid grid-cols-7 gap-1 px-4 pt-3 text-center text-[10px] font-bold uppercase tracking-wide text-surface-400">
						{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
							<span key={day}>{day}</span>
						))}
					</div>

					{/* Day grid */}
					<div className="grid grid-cols-7 gap-1 px-4 py-2">
						{weeks.map((cell, index) => {
							const inMonth = cell.inMonth;
							const isToday =
								today.getFullYear() === cell.year &&
								today.getMonth() === cell.month &&
								today.getDate() === cell.day;
							const isSelected =
								parsed !== null &&
								parsed.year === cell.year &&
								parsed.month === cell.month &&
								parsed.day === cell.day;
							return (
								<button
									key={index}
									type="button"
									disabled={!inMonth}
									onClick={() =>
										// Keep the time the user already chose (or a sensible default).
										emit({
											...(parsed ?? defaultPartsNow()),
											year: cell.year,
											month: cell.month,
											day: cell.day,
										})
									}
									aria-label={cell.label}
									aria-pressed={isSelected}
									className={`flex h-9 items-center justify-center rounded-lg text-sm transition ${
										isSelected
											? "bg-brand-600 font-bold text-white shadow-sm"
											: inMonth
												? "text-slate-800 hover:bg-brand-50 hover:text-brand-700"
												: "cursor-default text-slate-300"
									} ${isToday && !isSelected ? "ring-1 ring-inset ring-brand-400 font-semibold" : ""}`}
								>
									{cell.day}
								</button>
							);
						})}
					</div>

					{/* Time row */}
					<div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
						<span className="text-xs font-bold uppercase tracking-wide text-surface-500">Time</span>
						<div className="flex items-center gap-2">
							<select
								aria-label="Hour"
								className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
								value={current.hour}
								onChange={(event) => patch({ hour: Number(event.target.value) })}
							>
								{Array.from({ length: 24 }, (_, hour) => (
									<option key={hour} value={hour}>
										{String(hour).padStart(2, "0")}
									</option>
								))}
							</select>
							<span className="text-lg font-black text-slate-400">:</span>
							<select
								aria-label="Minute"
								className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
								value={current.minute}
								onChange={(event) => patch({ minute: Number(event.target.value) })}
							>
								{Array.from({ length: 60 }, (_, minute) => (
									<option key={minute} value={minute}>
										{String(minute).padStart(2, "0")}
									</option>
								))}
							</select>
						</div>
					</div>

					{/* Footer */}
					<div className="flex items-center justify-between border-t border-slate-100 bg-surface-50 px-4 py-2.5">
						<button
							type="button"
							className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
							onClick={() => {
								onChange("");
								setOpen(false);
							}}
						>
							<X size={13} /> Clear
						</button>
						<button
							type="button"
							className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-700"
							onClick={() => setOpen(false)}
						>
							<Check size={13} strokeWidth={3} /> Done
						</button>
					</div>
				</div>
			</div>
			)}
		</>
	);
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function formatValue(parts: { year: number; month: number; day: number; hour: number; minute: number }): string {
	return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function defaultPartsNow() {
	const now = new Date();
	return {
		year: now.getFullYear(),
		month: now.getMonth(),
		day: now.getDate(),
		hour: now.getHours(),
		minute: now.getMinutes(),
	};
}

function formatDisplay(year: number, month: number, day: number, hour: number, minute: number): string {
	return `${new Date(year, month, day).toLocaleDateString(undefined, {
		day: "2-digit",
		month: "short",
		year: "numeric",
	})} · ${pad(hour)}:${pad(minute)}`;
}

type Cell = { day: number; month: number; year: number; inMonth: boolean; label: string };

/** Monday-first grid of the month; cells outside the month are greyed out. */
function buildMonthGrid(year: number, month: number): Cell[] {
	const first = new Date(year, month, 1);
	// getDay(): 0=Sun..6=Sat → days before the 1st in a Monday-first week.
	const offset = (first.getDay() + 6) % 7;
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const cells: Cell[] = [];

	for (let i = 0; i < 42; i++) {
		const dayNumber = i - offset + 1;
		let cellDate: Date;
		let inMonth = true;
		if (dayNumber < 1) {
			cellDate = new Date(year, month, dayNumber);
			inMonth = false;
		} else if (dayNumber > daysInMonth) {
			cellDate = new Date(year, month, dayNumber);
			inMonth = false;
		} else {
			cellDate = new Date(year, month, dayNumber);
		}
		cells.push({
			day: cellDate.getDate(),
			month: cellDate.getMonth(),
			year: cellDate.getFullYear(),
			inMonth,
			label: cellDate.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
		});
		if (i >= offset + daysInMonth - 1 && cells.length % 7 === 0 && i >= 27) break;
	}
	return cells;
}
