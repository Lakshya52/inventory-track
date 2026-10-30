import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { AppText } from "@/components/ui/app-text";
import { colors, MAX_WIDTH } from "@/theme";
import type { NavItem } from "./tabs";

type RoleTabBarProps = BottomTabBarProps & {
	items: NavItem[];
};

export function RoleTabBar({ state, navigateToTab, descriptors, items }: RoleTabBarProps) {
	const insets = useSafeAreaInsets();
	const activeName = state.routes[state.index]?.name;

	/**
	 * Pops a tab's nested stack back to its root screen (e.g. Management ->
	 * Products back to the Management overview). A targeted POP_TO_TOP action
	 * routes to the nested navigator by key and is a no-op if the tab has no
	 * nested stack or is already at its root. This works for every sub-page of
	 * every tab, not just products.
	 */
	const popTabToRoot = (tabRoute: { key: string; state?: { key?: string; index?: number } | null }) => {
		const nested = tabRoute.state;

		if (!nested?.key || (nested.index ?? 0) === 0) return;

		const childNav = (
			descriptors[tabRoute.key] as unknown as {
				navigation?: { dispatch?: (action: unknown) => void };
			}
		)?.navigation;

		console.log(`[tabbar] dispatching POP_TO_TOP, hasDispatch=${typeof childNav?.dispatch}`);
		childNav?.dispatch?.({ type: 'POP_TO_TOP', target: nested.key });
	};

	const navigate = (item: NavItem) => {
		const route = state.routes.find(
			(candidate) => candidate.name === item.name,
		);
		if (!route) return;

		if (activeName !== item.name) {
			// Switching away from the active tab: reset any deep sub-pages it
			// holds, so the next time this tab is opened it shows its main
			// screen (the 6-tile Management overview, for the manage tab).
			popTabToRoot(state.routes[state.index]);
			navigateToTab(route.key);
		} else {
			// Pressing the tab that is already active: classic tab-tap reset
			// back to its main screen.
			popTabToRoot(route);
		}
	};

	return (
		<View
			className="relative w-full pt-[15px] bg-transparent"
			style={{ paddingBottom: Math.max(insets.bottom, 8) }}
		>
			{/* LinearGradient: Solid white at the bottom blending to perfectly clear at the top */}
			<LinearGradient
				colors={[
					"rgba(255, 255, 255, 1.00)", // Bottom: solid white
					"rgba(255, 255, 255, 0.00)", // Top: completely transparent fade
				]}
				start={{ x: 0, y: 1 }}
				end={{ x: 0, y: 0 }}
				style={StyleSheet.absoluteFill}
				pointerEvents="none"
			/>

			<View
				className="w-full self-center px-5"
				style={{ maxWidth: MAX_WIDTH }}
			>
				{/* Included 'will-change-variable' to guarantee zero layout flash or warnings */}
				<View className="h-[72px] flex-row items-center w-full justify-between rounded-full bg-navy px-3 shadow-sm will-change-variable">
					{items.map((item) => {
						const focused = activeName === item.name;
						const Icon = item.icon;

						return (
							<Pressable
								key={item.name}
								accessibilityRole="tab"
								accessibilityState={{ selected: focused }}
								accessibilityLabel={item.label}
								onPress={() => navigate(item)}
								className="h-14 w-14 items-center justify-center"
								style={({ pressed }) =>
									pressed ? { opacity: 0.8 } : undefined
								}
							>
								<View
									className={
										focused
											? "h-14 w-14 items-center justify-center rounded-full bg-white"
											: "h-14 w-14 items-center justify-center"
									}
								>
									<Icon
										size={24}
										color={focused ? colors.navy : colors.white}
										strokeWidth={focused ? 2 : 1.8}
									/>
								</View>
							</Pressable>
						);
					})}
				</View>

				<View className="h-[19px] flex-row justify-between px-2 pt-[4px]">
					{items.map((item) => (
						<View key={item.name} className="w-14 items-center">
							{activeName === item.name ? (
								<AppText variant="navLabel" className="text-[11px]">
									{item.label}
								</AppText>
							) : null}
						</View>
					))}

				</View>
			</View>
		</View>
	);
}
