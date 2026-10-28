import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import {
  EllipsisVertical,
  FileClock,
  PieChart,
  ScanLine,
  Truck,
  Users,
  CircleCheck,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { BrandHeader } from '@/components/ui/brand';
import { QuickLink } from '@/components/ui/cards';
import { SectionLabel } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { useRole } from '@/context/role-context';

export default function DispatchHomeScreen() {
  const router = useRouter();
  const { user } = useRole();
  const go = (href: Href) => router.push(href);

  return (
    <View className="flex-1 bg-canvas">
      <BrandHeader />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-6">
          <AppText variant="display" className="text-[27px] leading-[36px]">
            Welcome, {user?.name.split(' ')[0] ?? 'Aarav'}
          </AppText>
          <AppText variant="caption" className="mt-0.5 text-[11px]">
            {user?.email ?? 'dispatch@klj.com'}
          </AppText>

          <View className="mt-5 flex-row flex-wrap justify-between gap-y-3">
            <StatCard
              icon={FileClock}
              value="5"
              label="Pending Requests"
              tone="peach"
              className="w-[48.2%]"
            />
            <StatCard
              icon={CircleCheck}
              value="18"
              label="Approved Today"
              tone="mint"
              className="w-[48.2%]"
            />
            <StatCard
              icon={Truck}
              value="12"
              label="Dispatched"
              tone="blue"
              className="w-[48.2%]"
            />
            <StatCard
              icon={Users}
              value="120"
              label="Clients"
              tone="purple"
              className="w-[48.2%]"
            />
          </View>

          <SectionLabel className="mt-6">Quick Links</SectionLabel>

          <View className="mt-3 gap-2">
            <View className="flex-row gap-2">
              <QuickLink
                icon={Truck}
                label="View Dispatches"
                tone="mint"
                onPress={() => go('/(dispatch)/orders')}
              />
              <QuickLink
                icon={ScanLine}
                label="Scan QR"
                tone="blue"
                onPress={() => router.push('/scan')}
              />
            </View>
            <View className="flex-row gap-2">
              <QuickLink
                icon={PieChart}
                label="Dispatch Reports"
                tone="purple"
                onPress={() => go('/(dispatch)/reports')}
              />
              <QuickLink
                icon={EllipsisVertical}
                label="Settings"
                tone="peach"
                onPress={() => go('/(dispatch)/settings')}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
