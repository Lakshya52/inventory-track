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
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";

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
import type { ReportKind, ReportPeriod, ReportScope } from "@/types";
import { useMemo, useState } from "react";

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

	const activities = reportActivities.slice(0, visibleActivities);

	const download = () => {
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

		Alert.alert(
			"Report ready",
			`${exportFormat} report has been generated for ${selectedPeriod}.`,
		);
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
								{period == "Custom"
									? "Custom Selected "
									: period}{" "}
								Quality Control Overview
							</AppText>

							<QualityChart />

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
									Download {exportFormat} Report
								</AppText>
							</Pressable>

							<SectionLabel className="mt-8">
								Activity On Selected Data Range
							</SectionLabel>

							<View className="mt-3 gap-[13px]">
								{activities.map((activity, index) => (
									<ActivityCard
										key={activity.id}
										index={index + 1}
										activity={activity}
									/>
								))}
							</View>

							{visibleActivities < reportActivities.length ? (
								<Pressable
									accessibilityRole="button"
									onPress={() =>
										setVisibleActivities((count) =>
											Math.min(
												count + 4,
												reportActivities.length,
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
								{period == "Custom"
									? "Custom Selected "
									: period}{" "}
								Dispatch Reports Overview
							</AppText>

							<View className="mt-4 flex-row flex-wrap justify-between gap-y-[9px]">
								<StatCard
									icon={Package}
									value="1200"
									label="Total Dispatches"
									tone="mint"
									className="w-[48.2%]"
								/>
								<StatCard
									icon={Users}
									value="120"
									label="Clients"
									tone="blue"
									className="w-[48.2%]"
								/>
								<StatCard
									icon={Scale}
									value="800 kg"
									label="Quantity Dispatched"
									tone="purple"
									className="w-[48.2%]"
								/>
								<StatCard
									icon={FileClock}
									value="5"
									label="Pending Dispatch Requests"
									tone="peach"
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
									Download {exportFormat} Report
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

function QualityChart() {
	const bars = [
		{ label: "QC Passed", height: 168, color: "#00FF11" },
		{ label: "QC Failed", height: 69, color: "#FF0000" },
	];

	return (
		<View className="mt-4 flex-row pl-1">
			<View
				className="w-10 justify-between items-end pr-2"
				style={{ height: 207 }}
			>
				{[70, 60, 50, 40, 30, 20, 10].map((value) => (
					<AppText
						key={value}
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
					Marked by : {activity.markedBy}, Email : {activity.email}
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
