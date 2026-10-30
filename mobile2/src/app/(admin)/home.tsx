import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import {
	Building2,
	ClipboardList,
	Clock3,
	FileClock,
	MapPin,
	Package,
	QrCode,
	ScanLine,
	Truck,
	UserRound,
	Users,
} from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { useCallback, useEffect, useState } from "react";

import { BrandHeader } from "@/components/ui/brand";
import { QuickLink } from "@/components/ui/cards";
import { AppText } from "@/components/ui/app-text";
import { PageHeading, SectionLabel } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat-card";
import { useRole } from "@/context/role-context";
import { apiRequest } from "@/services/api";
import { dispatchApi } from "@/services/dispatch";
import { qcApi } from "@/services/qc";
import { fetchAllUsers } from "@/services/users";
import type { LoadingSession } from "@/types";

export default function AdminHomeScreen() {
	const router = useRouter();
	const { user } = useRole();
	const [overview, setOverview] = useState({
		products: 0,
		users: 0,
		passed: 0,
		failed: 0,
		pending: 0,
	});
	const [activeSessions, setActiveSessions] = useState<LoadingSession[]>([]);

	const go = (href: Href) => router.push(href);

	const loadOverview = useCallback(async () => {
		const [products, users, qc, orders] = await Promise.allSettled([
			apiRequest<unknown[]>("/products"),
			fetchAllUsers(),
			qcApi.stats(),
			dispatchApi.allOrders(),
		]);
		setOverview({
			products:
				products.status === "fulfilled" ? products.value.length : 0,
			users:
				users.status === "fulfilled"
					? users.value.filter((item) => Number(item.is_active) === 1)
							.length
					: 0,
			passed: qc.status === "fulfilled" ? qc.value.passed : 0,
			failed: qc.status === "fulfilled" ? qc.value.failed : 0,
			pending:
				orders.status === "fulfilled"
					? orders.value.filter((item) => item.status === "PENDING")
							.length
					: 0,
		});
	}, []);

	const loadActiveSessions = useCallback(async () => {
		try {
			setActiveSessions(await dispatchApi.activeLoadingSessions());
		} catch (err) {
			console.warn("Could not refresh live loading sessions:", err);
		}
	}, []);

	useEffect(() => {
		// Load real dashboard totals after mount.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadOverview();
	}, [loadOverview]);

	useEffect(() => {
		// Keep the admin's loading monitor current while the dashboard is open.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadActiveSessions();
		const timer = setInterval(() => void loadActiveSessions(), 4000);
		return () => clearInterval(timer);
	}, [loadActiveSessions]);

	return (
		<View className="flex-1 overflow-hidden bg-canvas">
			<ScrollView
				style={{ flex: 1 }}
				className="flex-1"
				contentContainerStyle={{ paddingBottom: 26 }}
				showsVerticalScrollIndicator={false}
			>
				<BrandHeader />

				<View className="px-5 pt-10">
					<View className="flex-row items-center justify-between gap-3">
						<View className="min-w-0 flex-1">
							<PageHeading
								title={`Welcome ${user?.name.split(" ")[0] ?? "UserName"}`}
								subtitle={user?.email ?? ""}
							/>
						</View>
						{/* Scan shortcut - opens the QR scanner modal */}
						<Pressable
							onPress={() => router.push("/scan")}
							accessibilityRole="button"
							accessibilityLabel="Scan a QR code and view product details"
							hitSlop={8}
							className="h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-navy"
							style={({ pressed }) =>
								pressed ? { opacity: 0.85 } : undefined
							}
						>
							<ScanLine size={22} color="#FFFFFF" strokeWidth={2} />
						</Pressable>
					</View>
					<SectionLabel className="mt-[44px]">Overview</SectionLabel>
					<View className=" mt-[10px] flex-row flex-wrap justify-between gap-y-[9px]">
						<StatCard
							icon={Package}
							value={String(overview.products)}
							label="Total Products"
							tone="mint"
							className="w-[48.2%]"
						/>
						<StatCard
							icon={UserRound}
							value={String(overview.users)}
							label="Active Users"
							tone="blue"
							className="w-[48.2%]"
						/>
						<StatCard
							icon={ClipboardList}
							value={`${overview.passed} / ${overview.failed}`}
							label="Qc Passed / Failed"
							tone="purple"
							className="w-[48.2%]"
						/>
						<StatCard
							icon={FileClock}
							value={String(overview.pending)}
							label="Pending Requests"
							tone="peach"
							className="w-[48.2%]"
						/>
					</View>

					{activeSessions.length > 0 ? (
						<View className="mt-7">
							<View className="flex-row items-center justify-between">
								<SectionLabel>Live Loading</SectionLabel>
								<AppText className="text-[10px] font-manrope-semibold text-[#68758A]">
									Refreshes every 4 seconds
								</AppText>
							</View>
							<View className="mt-2.5 gap-2.5">
								{activeSessions.map((session) => {
									const total = Math.max(
										0,
										Number(session.total) || 0,
									);
									const scanned = Math.min(
										total,
										Math.max(
											0,
											Number(session.scanned) || 0,
										),
									);
									const progress =
										total > 0
											? Math.round(
													(scanned / total) * 100,
												)
											: 0;
									return (
										<View
											key={session.id}
											className="rounded-2xl border border-[#C9D8F0] bg-white p-4"
										>
											<View className="flex-row items-start justify-between gap-3">
												<View className="min-w-0 flex-1">
													<AppText
														className="text-[13px] font-manrope-bold text-navy"
														numberOfLines={1}
													>
														{session.product_name ||
															"Product"}{" "}
														· Batch{" "}
														{session.batch_number ||
															"—"}
													</AppText>
													<AppText className="mt-1 text-[10px] text-[#68758A]">
														Order #
														{
															session.dispatch_order_id
														}{" "}
														·{" "}
														{session.loader_name ||
															"Dispatcher"}
													</AppText>
												</View>
												<AppText className="shrink-0 text-[12px] font-manrope-extrabold text-navy">
													{scanned}/{total}
												</AppText>
											</View>
											<View className="mt-3 h-2 overflow-hidden rounded-full bg-[#E6EDF7]">
												<View
													className="h-full rounded-full bg-navy"
													style={{
														width: `${progress}%`,
													}}
												/>
											</View>
											<AppText className="mt-1 self-end text-[10px] font-manrope-bold text-[#51627D]">
												{progress}% loaded
											</AppText>
										</View>
									);
								})}
							</View>
						</View>
					) : null}

					<SectionLabel className="mt-[44px]">
						Quick Links
					</SectionLabel>

					<View className="mt-[10px] gap-[10px]">
						<View className="flex-row gap-[10px]">
							<QuickLink
								icon={Package}
								label="Products"
								tone="mint"
								onPress={() => go("/(admin)/manage/products")}
							/>
							<QuickLink
								icon={MapPin}
								label="Shelf Locations"
								tone="blue"
								onPress={() => go("/(admin)/manage/shelves")}
							/>
						</View>
						<View className="flex-row gap-[10px]">
							<QuickLink
								icon={Clock3}
								label="View Batches"
								tone="purple"
								onPress={() => go("/(admin)/manage/batches")}
							/>
							<QuickLink
								icon={UserRound}
								label="Manage Users"
								tone="peach"
								onPress={() => go("/(admin)/manage/users")}
							/>
						</View>
						<View className="flex-row gap-[10px]">
							<QuickLink
								icon={Users}
								label="Manage Clients"
								tone="mint"
								onPress={() => go("/(admin)/manage/clients")}
							/>
							<QuickLink
								icon={Building2}
								label="Manage Vendors"
								tone="blue"
								onPress={() => go("/(admin)/manage/vendors")}
							/>
						</View>
						<View className="flex-row gap-[10px]">
							<QuickLink
								icon={QrCode}
								label="View QR Codes"
								tone="purple"
								onPress={() => router.push("/scan")}
							/>
							<QuickLink
								icon={Truck}
								label="View Dispatches"
								tone="peach"
								onPress={() => go("/(admin)/dispatches")}
							/>
						</View>
					</View>
				</View>
			</ScrollView>
		</View>
	);
}

export const HomeIcon = ScanLine;
