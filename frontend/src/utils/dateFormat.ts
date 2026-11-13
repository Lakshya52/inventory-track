function parseDate(value: unknown): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value !== "string" && typeof value !== "number") return null;
	if (value === "") return null;

	if (typeof value === "string") {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (match) {
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			const date = new Date(year, month - 1, day);
			if (
				date.getFullYear() !== year ||
				date.getMonth() !== month - 1 ||
				date.getDate() !== day
			) {
				return null;
			}
			return date;
		}
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatCalendarDate(date: Date): string {
	const year = String(date.getFullYear()).padStart(4, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function formatDate(value: unknown, fallback = "-"): string {
	const date = parseDate(value);
	return date ? formatCalendarDate(date) : fallback;
}

export function formatDateOnly(value: unknown, fallback = "-"): string {
	if (typeof value === "string") {
		const match = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?Z)?$/.exec(
			value,
		);
		if (match) {
			const date = parseDate(match[1]);
			return date ? formatCalendarDate(date) : fallback;
		}
	}
	return formatDate(value, fallback);
}

export function formatDateTime(
	value: unknown,
	timeOptions: Intl.DateTimeFormatOptions = {
		hour: "2-digit",
		minute: "2-digit",
	},
	fallback = "-",
): string {
	const date = parseDate(value);
	if (!date) return fallback;
	return `${formatCalendarDate(date)} ${date.toLocaleTimeString(
		undefined,
		timeOptions,
	)}`;
}
