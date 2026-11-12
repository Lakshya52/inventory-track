import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import {
  ClipboardCheck,
  CircleCheck,
  CircleX,
  PieChart,
  Plus,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useCallback, useEffect, useState } from 'react';

import { AppText } from '@/components/ui/app-text';
import { BrandHeader } from '@/components/ui/brand';
import { QuickLink } from '@/components/ui/cards';
import { SectionLabel } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { useRole } from '@/context/role-context';
import { qcApi } from '@/services/qc';

export default function QCHomeScreen() {
  const router = useRouter();
  const { user } = useRole();
  const [stats, setStats] = useState({ pendingQc: 0, passed: 0, failed: 0, testsToday: 0 });
  const go = (href: Href) => router.push(href);

  const loadStats = useCallback(async () => {
    const qc = await qcApi.stats().catch(() => null);
    setStats({
      pendingQc: qc?.pendingQc ?? 0,
      passed: qc?.passed ?? 0,
      failed: qc?.failed ?? 0,
      testsToday: qc?.testsToday ?? 0,
    });
  }, []);

  useEffect(() => {
    // Load live QC totals.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStats();
  }, [loadStats]);

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
              icon={CircleCheck}
              value={String(stats.passed)}
              label="QC Passed"
              tone="mint"
              className="w-[48.2%]"
            />
            <StatCard
              icon={CircleX}
              value={String(stats.failed)}
              label="QC Failed"
              tone="purple"
              className="w-[48.2%]"
            />
            <StatCard
              icon={ClipboardCheck}
              value={String(stats.testsToday)}
              label="QC Checks Today"
              tone="blue"
              className="w-[48.2%]"
            />
          </View>

          <SectionLabel className="mt-6">Quick Links</SectionLabel>

          <View className="mt-3 gap-2">
            <View className="flex-row gap-2">
              <QuickLink
                icon={Plus}
                label="Create QC Batch"
                tone="mint"
                onPress={() => go('/(qc)/batches')}
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
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
