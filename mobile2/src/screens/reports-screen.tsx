import {
	Download,
	FileText,
	Table2,
	Database,
	Package,
	Users,
	Scale,
	FileClock,
} from "lucide-react-native";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from "react-native";
import * as FileSystem from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import DateTimePicker, {
	DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import { AppText } from "@/components/ui/app-text";
import { OptionSheet } from "@/components/ui/bottom-sheet";
import {
	PageHeading,
	SectionLabel,
	SelectField,
	FilterChips,
} from "@/components/ui/page";
import { Screen } from "@/components/ui/screen";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { reportActivities } from "@/data/mock";
import { reportsApi, type AdminReportData, type ReportRow } from "@/services/reports";
import type { ReportKind, ReportPeriod, ReportScope } from "@/types";
import { useEffect, useMemo, useState } from "react";

const periods = ["Monthly", "Weekly", "Yearly", "Custom"] as const;

type ReportsScreenProps = {
	scope: ReportScope;
};

export function ReportsScreen({ scope }: ReportsScreenProps) {
	const initialKind: ReportKind =
		scope === "dispatch" ? "dispatch" : "quality";
	// kind : the type of report to show, either quality control or dispatch reports
	const [kind, setKind] = useState<ReportKind>(initialKind);
	// period : the time period for which the report is generated, can be monthly, weekly, yearly or custom, by default it is monthly
	const [period, setPeriod] = useState<ReportPeriod>("Monthly");
	const [kindSheet, setKindSheet] = useState(false);
	const [exportFormat, setExportFormat] = useState<"PDF" | "Excel" | "CSV">("PDF");
	const [visibleActivities, setVisibleActivities] = useState(4);

	const [selectedDate, setSelectedDate] = useState(new Date());
	const [startDate, setStartDate] = useState<Date | null>(null);
	const [endDate, setEndDate] = useState<Date | null>(null);
	const [datePickerTarget, setDatePickerTarget] = useState<"start" | "end" | null>(null);
	const [periodPickerVisible, setPeriodPickerVisible] = useState(false);
	const [calendarMonth, setCalendarMonth] = useState(
		new Date(new Date().getFullYear(), new Date().getMonth(), 1),
	);
	const [monthPickerYear, setMonthPickerYear] = useState(new Date().getFullYear());
	const [reportData, setReportData] = useState<AdminReportData | null>(null);
	const [reportError, setReportError] = useState("");
	const [reportErrorKey, setReportErrorKey] = useState("");
	const [loadedReportKey, setLoadedReportKey] = useState("");
	const [exporting, setExporting] = useState(false);
	const customRangeIncomplete = period === "Custom" && (!startDate || !endDate);

	const kindOptions = useMemo(() => {
		const all = [
			{ label: "Quality Control", value: "quality" },
			{ label: "Dispatch Reports", value: "dispatch" },
		];
		if (scope === "qc")
			return all.filter((option) => option.value === "quality");
		if (scope === "dispatch")
			return all.filter((option) => option.value === "dispatch");
		return all;
	}, [scope]);

	const dateRange = useMemo(() => {
		const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		if (period === "Custom") {
			return startDate && endDate ? { from: dateKey(startDate), to: dateKey(endDate) } : undefined;
		}
		if (period === "Monthly") {
			return {
				from: dateKey(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)),
				to: dateKey(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)),
			};
		}
		if (period === "Weekly") {
			const from = getWeekStart(selectedDate);
			const to = new Date(from);
			to.setDate(to.getDate() + 6);
			return { from: dateKey(from), to: dateKey(to) };
		}
		return {
			from: `${selectedDate.getFullYear()}-01-01`,
			to: `${selectedDate.getFullYear()}-12-31`,
		};
	}, [period, selectedDate, startDate, endDate]);
	const reportKey = `${period}:${dateRange?.from ?? ""}:${dateRange?.to ?? ""}`;
	const displayedReportError = customRangeIncomplete
		? "Select both dates to load a custom-range report."
		: reportErrorKey === reportKey ? reportError : "";
	const displayedReportLoading = scope === "admin" && !customRangeIncomplete && !displayedReportError && loadedReportKey !== reportKey;
	const displayedReportData = customRangeIncomplete || loadedReportKey !== reportKey ? null : reportData;

	useEffect(() => {
		if (scope !== "admin") return;
		if (customRangeIncomplete) return;
		let cancelled = false;
		reportsApi.loadAdminReport(dateRange)
			.then((data) => { if (!cancelled) { setReportData(data); setLoadedReportKey(reportKey); setReportError(""); setReportErrorKey(""); } })
			.catch((error) => { if (!cancelled) { setReportData(null); setLoadedReportKey(reportKey); setReportError(error instanceof Error ? error.message : "Could not load reports."); setReportErrorKey(reportKey); } });
		return () => { cancelled = true; };
	}, [scope, customRangeIncomplete, dateRange, reportKey]);

	const qcActivities = useMemo(() => (displayedReportData?.qc ?? []).map((row, index) => ({
		id: String(row.id ?? index),
		batch: String(row.batch_number ?? row.batch_id ?? "—"),
		markedBy: String(row.tester_name ?? "QC"),
		email: "",
		product: String(row.product_name ?? "Product"),
		sku: String(row.product_sku ?? "—"),
		quantity: Number(row.quantity ?? 0),
		date: row.created_at ? new Date(String(row.created_at)).toLocaleDateString("en-IN") : "—",
		status: "passed" as const,
	})), [displayedReportData]);
	const activities = (scope === "admin" ? qcActivities : reportActivities).slice(0, visibleActivities);
	const passedCount = scope === "admin" ? qcActivities.length : 0;
	const dispatchRows = displayedReportData?.dispatch ?? [];
	const dispatchedRows = dispatchRows.filter((row) => Number(row.dispatched) === 1 || row.outcome === "DISPATCHED");
	const dispatchQuantity = dispatchedRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
	const clientCount = new Set(dispatchedRows.map((row) => String(row.client_name ?? "").trim()).filter(Boolean)).size;
	const pendingRequests = (displayedReportData?.requests ?? []).filter((row) => row.status === "PENDING").length;

	const download = async () => {
		if (scope === "admin" && (!displayedReportData || customRangeIncomplete)) {
			Alert.alert("Report unavailable", displayedReportError || "Wait for the report data to finish loading.");
			return;
		}
		let selectedPeriod: string;

		if (period === "Custom") {
			selectedPeriod =
				startDate && endDate
					? `${startDate.toLocaleDateString("en-IN")} - ${endDate.toLocaleDateString("en-IN")}`
					: "an incomplete custom date range";
		} else if (period === "Monthly") {
			selectedPeriod = selectedDate.toLocaleDateString("en-IN", {
				month: "long",
				year: "numeric",
			});
		} else if (period === "Weekly") {
			selectedPeriod = `Week of ${getWeekStart(selectedDate).toLocaleDateString("en-IN")}`;
		} else {
			selectedPeriod = String(selectedDate.getFullYear());
		}

		if (scope !== "admin" || !reportData) {
			Alert.alert("Report unavailable", "Live report data is available to Admin users.");
			return;
		}
		setExporting(true);
		try {
			const rows = reportRows(kind, displayedReportData!);
			const filename = `${kind}-report-${dateRange?.from ?? "all"}-${dateRange?.to ?? "time"}`;
			if (exportFormat === "PDF") {
				const html = buildReportHtml(kind, selectedPeriod, rows);
				const { base64 } = await Print.printToFileAsync({ html, base64: true });
				if (!base64) throw new Error("The PDF was created without readable file data.");
				const shareablePdf = new FileSystem.File(FileSystem.Paths.cache, `${filename}-${Date.now()}.pdf`);
				await shareablePdf.write(base64, { encoding: "base64" });
				if (!shareablePdf.exists || !shareablePdf.size) throw new Error("The PDF was created but could not be prepared for sharing.");
				await Sharing.shareAsync(shareablePdf.uri, { UTI: ".pdf", mimeType: "application/pdf", dialogTitle: `${kind} report` });
			} else {
				const contents = exportFormat === "CSV" ? toCsv(rows) : toExcelXml(rows);
				const extension = exportFormat === "CSV" ? "csv" : "xls";
				const mimeType = exportFormat === "CSV" ? "text/csv" : "application/vnd.ms-excel";
				const file = new FileSystem.File(FileSystem.Paths.cache, `${filename}.${extension}`);
				await file.write(contents);
				await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: `${kind} report` });
			}
		} catch (error) {
			Alert.alert("Export failed", error instanceof Error ? error.message : "Could not create this report file.");
		} finally {
			setExporting(false);
		}
	};



	return (
		<Screen>
			<ScrollView
				className="flex-1"
				contentContainerStyle={{ paddingBottom: 28 }}
				showsVerticalScrollIndicator={false}
			>
				<View className="px-5 pt-6">
					<PageHeading
						title="Reports & Analysis"
						subtitle="Review QC check, dispatch, dispatch request, product and inventory record."
					/>
					{scope === "admin" && displayedReportLoading ? <View className="mt-4 flex-row items-center gap-2"><ActivityIndicator color="#011A87" /><AppText className="text-[12px] text-[#5B6980]">Loading live report data…</AppText></View> : null}
					{scope === "admin" && displayedReportError ? <AppText className="mt-4 rounded-xl bg-[#FFF2F3] p-3 text-[12px] text-[#B42332]">{displayedReportError}</AppText> : null}

					<SectionLabel className="mt-6">
						Select Report Type
					</SectionLabel>
					<SelectField
						className="mt-2"
						value={
							kind === "quality"
								? "Quality Control"
								: "Dispatch Reports"
						}
						onPress={() => setKindSheet(true)}
					/>

					<View className="mt-2">
						<FilterChips
							options={periods}
							value={period}
							onChange={setPeriod}
						/>
					</View>

					{period === "Custom" ? (
						<View className="mt-3 flex-row gap-3">
							<View className="flex-1">
								<SelectField
									variant="soft"
									prefix="From:"
									value={startDate?.toLocaleDateString("en-IN") ?? "Start date"}
									onPress={() => setDatePickerTarget("start")}
								/>
							</View>

							<View className="flex-1">
								<SelectField
									variant="soft"
									prefix="To:"
									value={endDate?.toLocaleDateString("en-IN") ?? "End date"}
									onPress={() => setDatePickerTarget("end")}
								/>
							</View>
						</View>
					) : (
						<SelectField
							className="mt-3 w-[252px]"
							variant="soft"
							prefix={
								period === "Monthly"
									? "Select Month:"
									: period === "Weekly"
										? "Select Week:"
										: "Select Year:"
							}
							value={
								period === "Monthly"
									? selectedDate.toLocaleDateString("en-IN", {
											month: "long",
											year: "numeric",
										})
									: period === "Weekly"
										? `Week of ${getWeekStart(selectedDate).toLocaleDateString("en-IN")}`
										: String(selectedDate.getFullYear())
							}
							onPress={() => {
							setCalendarMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
							setMonthPickerYear(selectedDate.getFullYear());
							setPeriodPickerVisible(true);
						}}
						/>
					)}

					{kind === "quality" ? (
						<>
							<AppText
								variant="label"
								className="mt-8 text-center text-[12px]"
								style={{ fontFamily: "Manrope_600SemiBold" }}
							>
								{period === "Custom"
									? "Custom Selected "
									: period}{" "}
								Quality Control Overview
							</AppText>

							<QualityChart passed={passedCount} failed={0} />

							<SectionLabel className="mt-[52px]">
								Export Reports
							</SectionLabel>
							<View className="mt-5 flex-row gap-[10px]">
								<ExportCard
									icon={FileText}
									title="PDF"
									caption="Portable Doc"
									color="#F2545B"
									active={exportFormat === "PDF"}
									onPress={() => setExportFormat("PDF")}
								/>
								<ExportCard
									icon={Table2}
									title="Excel"
									caption="Spreadsheet"
									color="#2DB56C"
									active={exportFormat === "Excel"}
									onPress={() => setExportFormat("Excel")}
								/>
								<ExportCard
									icon={Database}
									title="CSV"
									caption="Raw Data"
									color="#3D8BD9"
									active={exportFormat === "CSV"}
									onPress={() => setExportFormat("CSV")}
								/>
							</View>

							<Pressable
								accessibilityRole="button"
				disabled={exporting || (scope === "admin" && (displayedReportLoading || !reportData || customRangeIncomplete))}
								onPress={download}
								className="mt-8 h-[63px] flex-row items-center justify-center gap-2 rounded-[10px] bg-[#AFE2F9]"
								style={({ pressed }) =>
									pressed ? { opacity: 0.85 } : undefined
								}
							>
								<Download
									size={22}
									color="#011A87"
									strokeWidth={2.1}
								/>
								<AppText
									className="text-[18px] text-navy"
									style={{ fontFamily: "Manrope_700Bold" }}
								>
									{exporting ? "Preparing" : `Download ${exportFormat} Report`}
								</AppText>
							</Pressable>

							<SectionLabel className="mt-8">
								Activity On Selected Data Range
							</SectionLabel>

							<View className="mt-3 gap-[13px]">
								{scope === "admin" && !displayedReportLoading && !displayedReportError && activities.length === 0 ? <AppText className="rounded-xl border border-dashed border-[#C7D6EA] bg-white p-4 text-center text-[12px] text-[#68758A]">No QC records in this date range.</AppText> : null}
								{activities.map((activity, index) => (
									<ActivityCard
										key={activity.id}
										index={index + 1}
										activity={activity}
									/>
								))}
							</View>

							{visibleActivities < (scope === "admin" ? qcActivities.length : reportActivities.length) ? (
								<Pressable
									accessibilityRole="button"
									onPress={() =>
										setVisibleActivities((count) =>
											Math.min(
												count + 4,
												scope === "admin" ? qcActivities.length : reportActivities.length,
											),
										)
									}
									className="mt-5 h-[30px] items-center justify-center self-center rounded-full border border-navy px-5"
									style={({ pressed }) =>
										pressed ? { opacity: 0.7 } : undefined
									}
								>
									<AppText
										variant="label"
										className="text-[11px]"
									>
										Load more
									</AppText>
								</Pressable>
							) : null}
						</>
					) : (
						<>
							<AppText
								variant="label"
								className="mt-8 text-center text-[12px]"
								style={{ fontFamily: "Manrope_600SemiBold" }}
							>
								{period === "Custom"
									? "Custom Selected "
									: period}{" "}
								Dispatch Reports Overview
							</AppText>

							<View className="mt-4 flex-row flex-wrap justify-between gap-y-[9px]">
								<StatCard
									icon={Package}
									value={String(dispatchRows.length)}
									label="Dispatch Records"
									tone="mint"
									className="w-[48.2%]"
								/>
								<StatCard
									icon={Users}
									value={String(clientCount)}
									label="Clients"
									tone="blue"
									className="w-[48.2%]"
								/>
								<StatCard
									icon={Scale}
									value={String(dispatchQuantity)}
									label="Dispatched Quantity"
									tone="purple"
									className="w-[48.2%]"
								/>
								<StatCard
									icon={FileClock}
									value={String(pendingRequests)}
									label="Pending Dispatch Requests"
									tone="peach"
									className="w-[48.2%]"
								/>
								<StatCard
									icon={Package}
									value={String(displayedReportData?.inventory.length ?? 0)}
									label="Products in Inventory"
									tone="mint"
									className="w-[48.2%]"
								/>
							</View>

							<SectionLabel className="mt-[52px]">
								Export Detailed Reports
							</SectionLabel>
							<View className="mt-5 flex-row gap-[10px]">
								<ExportCard
									icon={FileText}
									title="PDF"
									caption="Portable Doc"
									color="#F2545B"
									active={exportFormat === "PDF"}
									onPress={() => setExportFormat("PDF")}
								/>
								<ExportCard
									icon={Table2}
									title="Excel"
									caption="Spreadsheet"
									color="#2DB56C"
									active={exportFormat === "Excel"}
									onPress={() => setExportFormat("Excel")}
								/>
								<ExportCard
									icon={Database}
									title="CSV"
									caption="Raw Data"
									color="#3D8BD9"
									active={exportFormat === "CSV"}
									onPress={() => setExportFormat("CSV")}
								/>
							</View>

							<Pressable
								accessibilityRole="button"
				disabled={exporting || (scope === "admin" && (displayedReportLoading || !reportData || customRangeIncomplete))}
								onPress={download}
								className="mt-8 h-[63px] flex-row items-center justify-center gap-2 rounded-[10px] bg-[#AFE2F9]"
								style={({ pressed }) =>
									pressed ? { opacity: 0.85 } : undefined
								}
							>
								<Download
									size={22}
									color="#011A87"
									strokeWidth={2.1}
								/>
								<AppText
									className="text-[18px] text-navy"
									style={{ fontFamily: "Manrope_700Bold" }}
								>
									{exporting ? "Preparing" : `Download ${exportFormat} Report`}
								</AppText>
							</Pressable>
						</>
					)}
				</View>
			</ScrollView>

			<OptionSheet
				visible={kindSheet}
				title="Select report type"
				options={kindOptions}
				value={kind}
				onSelect={(value) => {
					setKind(value as ReportKind);
					setKindSheet(false);
				}}
				onClose={() => setKindSheet(false)}
			/>

			{datePickerTarget !== null && (
				<DateTimePicker
					value={datePickerTarget === "start" ? startDate ?? new Date() : endDate ?? startDate ?? new Date()}
					mode="date"
					maximumDate={new Date()}
					minimumDate={datePickerTarget === "end" && startDate ? startDate : undefined}
					onChange={(event: DateTimePickerEvent, pickedDate?: Date) => {
						const target = datePickerTarget;
						setDatePickerTarget(null);
						if (event.type !== "set" || !pickedDate) return;
						if (target === "start") {
							setStartDate(pickedDate);
							if (endDate && endDate < pickedDate) setEndDate(null);
						} else {
							setEndDate(pickedDate);
						}
					}}
				/>
			)}

			<Modal
				visible={periodPickerVisible}
				transparent
				animationType="fade"
				onRequestClose={() => setPeriodPickerVisible(false)}
			>
				<Pressable className="flex-1 items-center justify-center bg-black/40 px-5" onPress={() => setPeriodPickerVisible(false)}>
					<Pressable className="w-full max-w-[380px] rounded-2xl bg-white p-5" onPress={(event) => event.stopPropagation()}>
						{period === "Monthly" ? (
							<>
								<AppText className="text-lg text-navy" style={{ fontFamily: "Manrope_700Bold" }}>Select month</AppText>
								<View className="mt-4 flex-row items-center justify-between">
									<Pressable className="rounded-lg bg-[#EEF5FA] px-4 py-2" onPress={() => setMonthPickerYear((year) => year - 1)}><AppText className="text-navy">‹</AppText></Pressable>
									<AppText className="text-base text-navy" style={{ fontFamily: "Manrope_700Bold" }}>{monthPickerYear}</AppText>
									<Pressable className="rounded-lg bg-[#EEF5FA] px-4 py-2" disabled={monthPickerYear >= new Date().getFullYear()} onPress={() => setMonthPickerYear((year) => Math.min(year + 1, new Date().getFullYear()))}><AppText className="text-navy">›</AppText></Pressable>
								</View>
								<View className="mt-4 flex-row flex-wrap">
									{Array.from({ length: 12 }, (_, index) => index).map((monthIndex) => {
										const monthLabel = new Date(2000, monthIndex, 1).toLocaleDateString("en-IN", { month: "short" });
										const active = selectedDate.getFullYear() === monthPickerYear && selectedDate.getMonth() === monthIndex;
										const future = monthPickerYear === new Date().getFullYear() && monthIndex > new Date().getMonth();
										return <Pressable key={monthIndex} disabled={future} onPress={() => { setSelectedDate(new Date(monthPickerYear, monthIndex, 1)); setPeriodPickerVisible(false); }} className={`mb-2 w-1/3 items-center px-1`}><View className={`w-full items-center rounded-xl py-3 ${active ? "bg-[#AFE2F9]" : "bg-[#F3F7FA]"} ${future ? "opacity-35" : ""}`}><AppText className="text-sm text-navy" style={{ fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold" }}>{monthLabel}</AppText></View></Pressable>;
									})}
								</View>
							</>
						) : period === "Yearly" ? (
							<>
								<AppText className="text-lg text-navy" style={{ fontFamily: "Manrope_700Bold" }}>Select year</AppText>
								<ScrollView className="mt-4 max-h-[360px]" showsVerticalScrollIndicator={false}>
									<View className="flex-row flex-wrap">
										{Array.from({ length: 31 }, (_, index) => new Date().getFullYear() - index).map((year) => {
											const active = selectedDate.getFullYear() === year;
											return <Pressable key={year} onPress={() => { setSelectedDate(new Date(year, selectedDate.getMonth(), 1)); setPeriodPickerVisible(false); }} className="w-1/3 p-1"><View className={`items-center rounded-xl py-3 ${active ? "bg-[#AFE2F9]" : "bg-[#F3F7FA]"}`}><AppText className="text-sm text-navy" style={{ fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold" }}>{year}</AppText></View></Pressable>;
										})}
									</View>
								</ScrollView>
							</>
						) : (
							<>
								<View className="flex-row items-center justify-between">
									<Pressable className="rounded-lg bg-[#EEF5FA] px-4 py-2" onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}><AppText className="text-navy">‹</AppText></Pressable>
									<AppText className="text-base text-navy" style={{ fontFamily: "Manrope_700Bold" }}>{calendarMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</AppText>
									<Pressable className="rounded-lg bg-[#EEF5FA] px-4 py-2" disabled={calendarMonth.getFullYear() === new Date().getFullYear() && calendarMonth.getMonth() >= new Date().getMonth()} onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}><AppText className="text-navy">›</AppText></Pressable>
								</View>
								<View className="mt-4 flex-row">
									{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <View key={`${day}-${index}`} className="flex-1 items-center py-2"><AppText className="text-xs text-slate-500">{day}</AppText></View>)}
								</View>
								{(() => {
									const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
									const offset = (firstDay.getDay() + 6) % 7;
									const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
									const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => index - offset + 1);
									const selectedWeekStart = getWeekStart(selectedDate).getTime();
									return Array.from({ length: Math.ceil(cells.length / 7) }, (_, weekIndex) => {
										const weekCells = cells.slice(weekIndex * 7, weekIndex * 7 + 7);
										const validDays = weekCells.filter((day) => day >= 1 && day <= daysInMonth);
										const representative = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), validDays[0] ?? 1);
										const weekStart = getWeekStart(representative).getTime();
										const activeWeek = weekStart === selectedWeekStart;
										return <Pressable key={weekIndex} onPress={() => { setSelectedDate(getWeekStart(representative)); setPeriodPickerVisible(false); }} className={`flex-row rounded-lg ${activeWeek ? "bg-[#AFE2F9]" : ""}`}>
											{weekCells.map((day, dayIndex) => {
												const valid = day >= 1 && day <= daysInMonth;
												return <View key={dayIndex} className="flex-1 items-center py-2"><AppText className={`text-sm ${valid ? "text-navy" : "text-transparent"}`} style={{ fontFamily: activeWeek && valid ? "Manrope_700Bold" : "Manrope_600SemiBold" }}>{valid ? day : "·"}</AppText></View>;
											})}
										</Pressable>;
									});
								})()}
								<AppText className="mt-3 text-xs text-slate-500">Tap any week row to select that week.</AppText>
							</>
						)}
						<Pressable className="mt-5 items-center rounded-xl bg-[#011A87] py-3" onPress={() => setPeriodPickerVisible(false)}><AppText className="text-white" style={{ fontFamily: "Manrope_700Bold" }}>Close</AppText></Pressable>
					</Pressable>
				</Pressable>
			</Modal>
		</Screen>
	);
}

function getWeekStart(date: Date) {
	const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const day = (result.getDay() + 6) % 7;
	result.setDate(result.getDate() - day);
	result.setHours(0, 0, 0, 0);
	return result;
}

function reportRows(kind: ReportKind, data: AdminReportData): ReportRow[] {
	if (kind === "quality") {
		return [
			...data.qc.map((row) => ({ report_type: "QC Record", ...row })),
			...data.batches.map((row) => ({ report_type: "Batch", ...row })),
		];
	}
	return [
		...data.dispatch.map((row) => ({ report_type: "Dispatch", ...row })),
		...data.requests.map((row) => ({ report_type: "Dispatch Request", ...row })),
		...data.inventory.map((row) => ({ report_type: "Current Inventory", ...row })),
	];
}

function cellText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function escapeCsv(value: unknown): string {
	return `"${cellText(value).replaceAll('"', '""')}"`;
}

function toCsv(rows: ReportRow[]): string {
	const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
	if (columns.length === 0) return "No records for the selected period.\r\n";
	return [columns.map(escapeCsv).join(","), ...rows.map((row) => columns.map((key) => escapeCsv(row[key])).join(","))].join("\r\n");
}

function escapeXml(value: unknown): string {
	return cellText(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function toExcelXml(rows: ReportRow[]): string {
	const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
	const tableRows = columns.length === 0
		? "<Row><Cell><Data ss:Type=\"String\">No records for the selected period.</Data></Cell></Row>"
		: [columns, ...rows.map((row) => columns.map((key) => row[key]))].map((values) =>
			`<Row>${values.map((value) => {
				const type = typeof value === "number" ? "Number" : "String";
				return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
			}).join("")}</Row>`
		).join("");
	return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${tableRows}</Table></Worksheet></Workbook>`;
}

function buildReportHtml(kind: ReportKind, selectedPeriod: string, rows: ReportRow[]): string {
	const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
	const headers = columns.map((key) => `<th>${escapeXml(key.replaceAll("_", " "))}</th>`).join("");
	const body = rows.map((row) => `<tr>${columns.map((key) => `<td>${escapeXml(row[key])}</td>`).join("")}</tr>`).join("");
	return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:12px Arial,sans-serif;color:#172033;padding:24px}h1{color:#011A87;font-size:20px}p{color:#526078}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #d6deea;padding:6px;text-align:left;word-break:break-word}th{background:#eef4ff}tr:nth-child(even){background:#f8fafc}</style></head><body><h1>${kind === "quality" ? "Quality Control" : "Dispatch"} Report</h1><p>Period: ${escapeXml(selectedPeriod)} · Records: ${rows.length}</p><table><thead><tr>${headers}</tr></thead><tbody>${body || `<tr><td colspan="${Math.max(columns.length, 1)}">No records for the selected period.</td></tr>`}</tbody></table></body></html>`;
}

function QualityChart({ passed, failed }: { passed: number; failed: number }) {
	const max = Math.max(1, passed, failed);
	const axisLabels = [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0];
	const bars = [
		{ label: `QC Passed · ${passed}`, height: Math.max(8, Math.round((passed / max) * 168)), color: "#19A96B" },
		{ label: `QC Failed · ${failed}`, height: Math.max(8, Math.round((failed / max) * 168)), color: "#E5484D" },
	];

	return (
		<View className="mt-4 flex-row pl-1">
			<View
				className="w-10 justify-between items-end pr-2"
				style={{ height: 207 }}
			>
				{axisLabels.map((value, index) => (
					<AppText
						key={`${value}-${index}`}
						variant="tiny"
						className="text-[9px] leading-[11px]"
					>
						{value}
					</AppText>
				))}
			</View>

			<View className="flex-1">
				<View
					className="flex-row items-end gap-[5px] border-b border-l border-navy pl-7"
					style={{ height: 207 }}
				>
					{bars.map((bar) => (
						<View
							key={bar.label}
							style={{
								height: bar.height,
								width: 114,
								backgroundColor: bar.color,
							}}
						/>
					))}
				</View>
				<View className="mt-2 flex-row gap-[5px] pl-7">
					{bars.map((bar) => (
						<AppText
							key={bar.label}
							variant="caption"
							tone="body"
							className="w-[114px] text-center text-[10px]"
							style={{ fontFamily: "Manrope_500Medium" }}
						>
							{bar.label}
						</AppText>
					))}
				</View>
			</View>
		</View>
	);
}

type ExportCardProps = {
	icon: typeof FileText;
	title: string;
	caption: string;
	color: string;
	active: boolean;
	onPress: () => void;
};

function ExportCard({
	icon: Icon,
	title,
	caption,
	color,
	active,
	onPress,
}: ExportCardProps) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
			onPress={onPress}
			className={
				active
					? "h-[93px] flex-1 items-center justify-center rounded-[10px] border-[1.5px] border-navy bg-white"
					: "h-[93px] flex-1 items-center justify-center rounded-[10px] border border-line bg-white"
			}
			style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
		>
			<Icon size={22} color={color} strokeWidth={1.8} />
			<AppText
				className="mt-1.5 text-[11px] text-navy"
				style={{ fontFamily: "Manrope_700Bold" }}
			>
				{title}
			</AppText>
			<AppText variant="tiny" className="mt-0.5 text-[8.5px]">
				{caption}
			</AppText>
		</Pressable>
	);
}

type ActivityCardProps = {
	index: number;
	activity: (typeof reportActivities)[number];
};

function ActivityCard({ index, activity }: ActivityCardProps) {
	const passed = activity.status === "passed";

	return (
		<View
			className={
				passed
					? "flex-row rounded-[10px] border-[1.2px] border-[#84D9B2] bg-[#F8FFFB] px-3 py-3"
					: "flex-row rounded-[10px] border-[1.2px] border-[#F3AAB2] bg-[#FFF8F9] px-3 py-3"
			}
		>
			<AppText
				className="w-5 pt-0.5 text-[12px] text-navy"
				style={{ fontFamily: "Manrope_700Bold" }}
			>
				{index}
			</AppText>

			<View className="flex-1">
				<View className="flex-row items-start justify-between gap-2">
					<AppText
						className="flex-1 text-[11.5px] leading-4 text-navy"
						style={{ fontFamily: "Manrope_700Bold" }}
					>
						Batch : {activity.batch}
					</AppText>
					<StatusBadge
						status={passed ? "passed" : "failed"}
						label={passed ? "Passed" : "Failed"}
					/>
				</View>

				<AppText
					className="mt-1 text-[10px] leading-[15px] text-navy"
					style={{ fontFamily: "Manrope_600SemiBold" }}
				>
					Marked by : {activity.markedBy}{activity.email ? `, Email : ${activity.email}` : ""}
				</AppText>
				<AppText
					className="text-[10px] leading-[15px] text-navy"
					style={{ fontFamily: "Manrope_600SemiBold" }}
				>
					Product : {activity.product}, SKU: {activity.sku}
				</AppText>
				<AppText
					className="text-[10px] leading-[15px] text-navy"
					style={{ fontFamily: "Manrope_600SemiBold" }}
				>
					Quantity : {activity.quantity}
				</AppText>

				<AppText
					className="mt-1 self-end text-[10px] text-navy"
					style={{ fontFamily: "Manrope_700Bold" }}
				>
					{activity.date}
				</AppText>
			</View>
		</View>
	);
}
