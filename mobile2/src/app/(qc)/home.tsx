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
import { dispatchApi } from '@/services/dispatch';
import { qcApi } from '@/services/qc';

export default function QCHomeScreen() {
  const router = useRouter();
  const { user } = useRole();
  const [stats, setStats] = useState({ pendingQc: 0, passed: 0, failed: 0, testsToday: 0, pendingApprovals: 0 });
  const go = (href: Href) => router.push(href);

  const loadStats = useCallback(async () => {
    const [qc, approvals] = await Promise.allSettled([qcApi.stats(), dispatchApi.pendingOrders()]);
    setStats({
      pendingQc: qc.status === 'fulfilled' ? qc.value.pendingQc : 0,
      passed: qc.status === 'fulfilled' ? qc.value.passed : 0,
      failed: qc.status === 'fulfilled' ? qc.value.failed : 0,
      testsToday: qc.status === 'fulfilled' ? qc.value.testsToday : 0,
      pendingApprovals: approvals.status === 'fulfilled' ? approvals.value.length : 0,
    });
  }, []);

  useEffect(() => {
    // Load live QC totals and pending order approvals.
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
              icon={ClipboardCheck}
              value={String(stats.pendingApprovals)}
              label="Pending Approvals"
              tone="peach"
              className="w-[48.2%]"
            />
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
                icon={ClipboardCheck}
                label="Dispatch Approvals"
                tone="purple"
                onPress={() => go('/(qc)/approvals')}
              />
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
