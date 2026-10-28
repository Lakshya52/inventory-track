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

export function RoleTabBar({ state, navigateToTab, items }: RoleTabBarProps) {
	const insets = useSafeAreaInsets();
	const activeName = state.routes[state.index]?.name;

	const navigate = (item: NavItem) => {
		const route = state.routes.find(
			(candidate) => candidate.name === item.name,
		);
		if (!route) return;
		if (activeName !== item.name) {
			navigateToTab(route.key);
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
				<View className="h-[72px] flex-row items-center justify-between rounded-full bg-navbar px-5 shadow-sm will-change-variable">
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
											? "h-14 w-14 items-center justify-center rounded-full bg-navy"
											: "h-14 w-14 items-center justify-center"
									}
								>
									<Icon
										size={24}
										color={focused ? colors.white : colors.navy}
										strokeWidth={focused ? 2 : 1.8}
									/>
								</View>
							</Pressable>
						);
					})}
				</View>

				<View className="h-[19px] flex-row justify-between px-5 pt-[4px]">
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
