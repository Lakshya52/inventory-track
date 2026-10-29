import { useCallback, useEffect, useState } from "react";
import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import {
	CircleCheck,
	EllipsisVertical,
	FileClock,
	History,
	Package,
	Play,
	ScanLine,
	Truck,
} from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { BrandHeader } from "@/components/ui/brand";
import { QuickLink } from "@/components/ui/cards";
import { PageHeading, SectionLabel } from "@/components/ui/page";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useRole } from "@/context/role-context";
import { dispatchApi, type DispatchStats } from "@/services/dispatch";
import type { DispatchOrder, LoadingSession } from "@/types";

export default function DispatchHomeScreen() {
	const router = useRouter();
	const { user } = useRole();
	const [stats, setStats] = useState<DispatchStats>({
		scope: "mine",
		totalDispatches: 0,
		dispatchedToday: 0,
		dispatchedThisWeek: 0,
		readyToDispatch: 0,
		pendingOrders: 0,
		approvedOrders: 0,
	});
	const [activeSession, setActiveSession] = useState<LoadingSession | null>(
		null,
	);
	const [recentOrders, setRecentOrders] = useState<DispatchOrder[]>([]);
	const [refreshing, setRefreshing] = useState(false);

	const go = (href: Href) => router.push(href);

	const loadData = useCallback(async () => {
		try {
			const [statsRes, sessionsRes, ordersRes] = await Promise.allSettled(
				[
					dispatchApi.stats(),
					dispatchApi.activeLoadingSessions(),
					dispatchApi.myOrders(),
				],
			);

			if (statsRes.status === "fulfilled" && statsRes.value) {
				setStats(statsRes.value);
			}
			if (
				sessionsRes.status === "fulfilled" &&
				Array.isArray(sessionsRes.value)
			) {
				setActiveSession(
					sessionsRes.value.length > 0 ? sessionsRes.value[0] : null,
				);
			}
			if (
				ordersRes.status === "fulfilled" &&
				Array.isArray(ordersRes.value)
			) {
				setRecentOrders(ordersRes.value.slice(0, 5));
			}
		} catch (err: any) {
			console.warn(
				"Could not load dispatch dashboard data:",
				err?.message,
			);
		} finally {
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		// This starts an async API fetch; state updates happen after the request resolves.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadData();
	}, [loadData]);

	const onRefresh = () => {
		setRefreshing(true);
		void loadData();
	};

	const progress =
		activeSession && activeSession.total > 0
			? Math.min(
					100,
					Math.round(
						(activeSession.scanned / activeSession.total) * 100,
					),
				)
			: 0;

	return (
		<View className="flex-1 bg-canvas">
			<BrandHeader />

			<ScrollView
				className="flex-1"
				contentContainerStyle={{ paddingBottom: 36 }}
				showsVerticalScrollIndicator={false}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={onRefresh}
						colors={["#011A87"]}
					/>
				}
			>
				<View className="px-5 pt-6">
					<PageHeading
						title={`Welcome, ${user?.name.split(" ")[0] ?? "there"}`}
						subtitle="Your dispatch workspace at a glance"
					/>

					<Pressable
						onPress={() => go("/(dispatch)/orders")}
						className="mt-5 overflow-hidden rounded-[26px] bg-navy p-5"
						style={({ pressed }) => pressed ? { opacity: 0.9 } : undefined}
					>
						<View className="flex-row items-start justify-between">
							<View className="flex-1 pr-3">
								<AppText className="text-[11px] font-manrope-bold uppercase tracking-[1.5px] text-blue-200">Dispatch desk</AppText>
								<AppText className="mt-2 text-[22px] leading-[28px] font-manrope-extrabold text-white">Keep every shipment moving.</AppText>
								<AppText className="mt-2 text-[12px] leading-[18px] text-blue-100">Review requests, prepare loads, and track what has left the warehouse.</AppText>
							</View>
							<View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
								<Truck size={24} color="#FFFFFF" />
							</View>
						</View>
						<View className="mt-4 self-start rounded-full bg-white px-4 py-2">
							<AppText className="text-[12px] font-manrope-bold text-navy">Open orders</AppText>
						</View>
					</Pressable>

					{/* ACTIVE LOADING SESSION BANNER */}
					{activeSession ? (
						<Pressable
							onPress={() => go("/(dispatch)/scan-check")}
							className="mt-5 rounded-2xl border-2 border-navy bg-white p-4 shadow-sm"
							style={({ pressed }) =>
								pressed ? { opacity: 0.9 } : undefined
							}
						>
							<View className="flex-row items-center justify-between">
								<View className="flex-row items-center gap-2">
									<View className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
									<AppText className="text-[11px] font-manrope-bold uppercase tracking-wider text-navy">
										Loading In Progress
									</AppText>
								</View>
								<View className="flex-row items-center gap-1 rounded-full bg-navy px-2.5 py-1">
									<Play
										size={10}
										color="#FFFFFF"
										fill="#FFFFFF"
									/>
									<AppText className="text-[10.5px] font-manrope-bold text-white">
										Resume
									</AppText>
								</View>
							</View>

							<AppText className="mt-2 text-[15px] font-manrope-extrabold text-navy">
								{activeSession.product_name || "Product"} ·
								Batch {activeSession.batch_number || "N/A"}
							</AppText>
							<AppText
								variant="caption"
								className="text-[11px] text-[#4E5D76]"
							>
								Order #{activeSession.dispatch_order_id}
							</AppText>

							{/* Progress counter */}
							<View className="mt-3 flex-row items-center justify-between">
								<AppText className="text-[13px] font-manrope-bold text-navy">
									{activeSession.scanned} /{" "}
									{activeSession.total} units loaded
								</AppText>
								<AppText className="text-[12px] font-manrope-bold text-[#011A87]">
									{progress}%
								</AppText>
							</View>
							<View className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
								<View
									className="h-full rounded-full bg-navy"
									style={{ width: `${progress}%` }}
								/>
							</View>
						</Pressable>
					) : null}

					{/* METRIC STAT CARDS */}
					<View className="mt-5 flex-row flex-wrap justify-between gap-y-3">
						<StatCard
							icon={FileClock}
							value={String(stats.pendingOrders ?? 0)}
							label="Pending Requests"
							tone="peach"
							className="w-[48.2%]"
						/>
						<StatCard
							icon={CircleCheck}
							value={String(stats.approvedOrders ?? 0)}
							label="Approved to Load"
							tone="mint"
							className="w-[48.2%]"
						/>
						<StatCard
							icon={Truck}
							value={String(stats.dispatchedToday ?? 0)}
							label="Dispatched Today"
							tone="blue"
							className="w-[48.2%]"
						/>
						<StatCard
							icon={Package}
							value={String(stats.readyToDispatch ?? 0)}
							label="Ready Batches"
							tone="purple"
							className="w-[48.2%]"
						/>
					</View>

					{/* QUICK LINKS */}
					<SectionLabel className="mt-6">Quick Links</SectionLabel>
					<View className="mt-3 gap-2">
						<View className="flex-row gap-2">
							<QuickLink
								icon={Truck}
								label="Orders & Requests"
								tone="mint"
								onPress={() => go("/(dispatch)/orders")}
							/>
							<QuickLink
								icon={ScanLine}
								label="Scan & Load"
								tone="blue"
								onPress={() => go("/(dispatch)/scan-check")}
							/>
						</View>
						<View className="flex-row gap-2">
							<QuickLink
								icon={History}
								label="Dispatch History"
								tone="purple"
								onPress={() => go("/(dispatch)/history")}
							/>
							<QuickLink
								icon={EllipsisVertical}
								label="Settings"
								tone="peach"
								onPress={() => go("/(dispatch)/settings")}
							/>
						</View>
					</View>

					{/* RECENT ORDERS FEED */}
					<View className="mt-6">
						<View className="flex-row items-center justify-between mb-3">
							<SectionLabel>Recent Dispatch Orders</SectionLabel>
							<Pressable onPress={() => go("/(dispatch)/orders")}>
								<AppText className="text-[11.5px] font-manrope-bold text-navy">
									View All
								</AppText>
							</Pressable>
						</View>

						{recentOrders.length === 0 ? (
							<View className="rounded-xl border border-dashed border-line bg-white p-5 items-center">
								<AppText
									variant="caption"
									className="text-[11px]"
								>
									No dispatch orders yet. Tap Orders to
									create a request.
								</AppText>
							</View>
						) : (
							<View className="gap-2.5">
								{recentOrders.map((order) => {
									const s = String(
										order.status || "",
									).toUpperCase();
									return (
										<Pressable
											key={order.id}
											onPress={() =>
												go("/(dispatch)/orders")
											}
											className="rounded-xl border border-line bg-white p-3.5"
											style={({ pressed }) =>
												pressed
													? { opacity: 0.85 }
													: undefined
											}
										>
											<View className="flex-row items-center justify-between">
												<View className="flex-1 pr-2">
													<AppText className="text-[13px] font-manrope-bold text-navy">
														Order #{order.id} ·{" "}
														{order.product_name ||
															"Product"}
													</AppText>
													<AppText
														variant="caption"
														className="mt-0.5 text-[10.5px] text-[#4E5D76]"
													>
														Customer:{" "}
														{order.client_name ||
															"N/A"}{" "}
														· Batch:{" "}
														{order.batch_number ||
															"N/A"}
													</AppText>
												</View>
												<StatusBadge
													status={s}
													label={
														s === "PENDING"
															? "Pending QC"
															: s ===
																		"APPROVED" ||
																  s ===
																		"DISPATCH_APPROVED"
																? "Approved"
																: s ===
																			"CLOSED_DISPATCHED" ||
																	  s ===
																			"DISPATCHED"
																	? "Dispatched"
																	: s ===
																		  "REJECTED"
																		? "Rejected"
																		: s
													}
												/>
											</View>
										</Pressable>
									);
								})}
							</View>
						)}
					</View>
				</View>
			</ScrollView>
		</View>
	);
}
