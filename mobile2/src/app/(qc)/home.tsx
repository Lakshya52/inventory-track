import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import {
  ClipboardCheck,
  CircleCheck,
  CircleX,
  EllipsisVertical,
  PieChart,
  ScanLine,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { BrandHeader } from '@/components/ui/brand';
import { QuickLink } from '@/components/ui/cards';
import { SectionLabel } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { useRole } from '@/context/role-context';

export default function QCHomeScreen() {
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
            Welcome, {user?.name.split(' ')[0] ?? 'Neha'}
          </AppText>
          <AppText variant="caption" className="mt-0.5 text-[11px]">
            {user?.email ?? 'qc@klj.com'}
          </AppText>

          <View className="mt-5 flex-row flex-wrap justify-between gap-y-3">
            <StatCard
              icon={ClipboardCheck}
              value="8"
              label="Pending QC"
              tone="peach"
              className="w-[48.2%]"
            />
            <StatCard
              icon={CircleCheck}
              value="45"
              label="QC Passed"
              tone="mint"
              className="w-[48.2%]"
            />
            <StatCard
              icon={CircleX}
              value="3"
              label="QC Failed"
              tone="purple"
              className="w-[48.2%]"
            />
            <StatCard
              icon={ClipboardCheck}
              value="20"
              label="Batches Today"
              tone="blue"
              className="w-[48.2%]"
            />
          </View>

          <SectionLabel className="mt-6">Quick Links</SectionLabel>

          <View className="mt-3 gap-2">
            <View className="flex-row gap-2">
              <QuickLink
                icon={ScanLine}
                label="Scan Product"
                tone="mint"
                onPress={() => go('/(qc)/scan-check')}
              />
              <QuickLink
                icon={ClipboardCheck}
                label="View Batches"
                tone="blue"
                onPress={() => go('/(qc)/batches')}
              />
            </View>
            <View className="flex-row gap-2">
              <QuickLink
                icon={PieChart}
                label="QC Reports"
                tone="purple"
                onPress={() => go('/(qc)/reports')}
              />
              <QuickLink
                icon={EllipsisVertical}
                label="Settings"
                tone="peach"
                onPress={() => go('/(qc)/settings')}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
