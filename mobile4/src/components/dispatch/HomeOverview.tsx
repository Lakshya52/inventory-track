import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { ClipboardList, Clock, Package, Printer, QrCode, ScanLine, Truck } from 'lucide-react-native';

import { AppHeader } from '@/components/layout/AppHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SectionHeading, ScreenTitle } from '@/components/common/Primitives';
import { useAuth } from '@/contexts/AuthContext';
import { domainApi } from '@/services/domain';
import { useAsyncData } from '@/hooks/useAsyncData';

function SmallKpi({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <View className="h-20 flex-1 justify-center rounded-2xl border border-[#e6e9f2] bg-canvas px-3 shadow-sm">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="text-lg font-lexend-bold text-brand">{value}</Text>
      </View>
      <Text className="mt-1 text-[10px] font-lexend text-muted">{label}</Text>
    </View>
  );
}

function GetStartedCard({
  step,
  icon,
  title,
  description,
  onPress,
}: {
  step: string;
  icon: ReactNode;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="h-40 flex-1 rounded-2xl border border-[#e6e9f2] bg-canvas p-4 shadow-sm">
      <View className="flex-row items-start justify-between">
        {icon}
        <Text className="text-[10px] font-lexend text-[#9aa1b4]">{step}</Text>
      </View>
      <Text className="mt-3 text-sm font-lexend-semibold text-brand">{title}</Text>
      <Text className="mt-1 text-[11px] font-lexend leading-4 text-muted">{description}</Text>
    </Pressable>
  );
}

export function HomeOverview() {
  const { session } = useAuth();
  const name = session?.user.name ?? 'User Name';

  const ordersData = useAsyncData(domainApi.dispatchOrders);
  const jobsData = useAsyncData(domainApi.qrJobs);
  const todayData = useAsyncData(domainApi.dispatchToday);
  const dashboardData = useAsyncData(domainApi.dashboard);

  const orders = ordersData.data;
  const jobs = jobsData.data;
  const today = todayData.data;
  const dashboard = dashboardData.data;

  const { refresh: refreshOrders } = ordersData;
  const { refresh: refreshJobs } = jobsData;
  const { refresh: refreshToday } = todayData;
  const { refresh: refreshDashboard } = dashboardData;

  const refreshing =
    ordersData.isRefreshing || jobsData.isRefreshing || todayData.isRefreshing || dashboardData.isRefreshing;

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refreshOrders(), refreshJobs(), refreshToday(), refreshDashboard()]);
  }, [refreshOrders, refreshJobs, refreshToday, refreshDashboard]);

  const readyToLoad = (orders ?? []).filter((o) => o.status === 'APPROVED').length;
  const waitingApproval = (orders ?? []).filter((o) => o.status === 'PENDING').length;
  const labelsWaiting = (jobs?.items ?? []).filter((j) => j.can_print_initial).length;
  const dispatchedToday = Array.isArray(today) ? today.length : Number(dashboard?.dispatchedToday ?? 0);

  return (
    <>
      <AppHeader title="Home" />
      <ScreenContainer edges={[]} scroll refreshing={refreshing} onRefresh={refreshAll}>
        <View className="px-5 pt-6">
          <ScreenTitle>{`Good Morning,\n${name}`}</ScreenTitle>

          <View className="mt-8">
            <SectionHeading>Quick KPIs / Overview</SectionHeading>
          </View>
          <View className="mt-3 gap-3">
            <View className="flex-row gap-3">
              <SmallKpi icon={<ClipboardList size={18} color="#4a72c4" />} value={String(readyToLoad)} label="Orders ready to load" />
              <SmallKpi icon={<Clock size={18} color="#d99032" />} value={String(waitingApproval)} label="Waiting for approval" />
            </View>
            <View className="flex-row gap-3">
              <SmallKpi icon={<QrCode size={18} color="#7b5cd6" />} value={String(labelsWaiting)} label="Labels waiting to print" />
              <SmallKpi icon={<Truck size={18} color="#0ba178" />} value={String(dispatchedToday)} label="Dispatched today" />
            </View>
          </View>

          <View className="mt-8">
            <SectionHeading>Get Started</SectionHeading>
          </View>
          <View className="mt-3 gap-3">
            <View className="flex-row gap-3">
              <GetStartedCard
                step="Step 1"
                icon={<Package size={22} color="#4a72c4" />}
                title="Create batch"
                description="Record the finished goods you received."
                onPress={() => router.push('/batches/create/select')}
              />
              <GetStartedCard
                step="Step 2"
                icon={<Printer size={22} color="#7b5cd6" />}
                title="Print QR labels"
                description="Print labels once QC passes the batch."
                onPress={() => router.push('/qr-print')}
              />
            </View>
            <View className="flex-row gap-3">
              <GetStartedCard
                step="Step 3"
                icon={<ClipboardList size={22} color="#d99032" />}
                title="Create dispatch order"
                description="Pick QC-approved stock for a customer."
                onPress={() => router.push('/dispatch/create')}
              />
              <GetStartedCard
                step="Step 4"
                icon={<ScanLine size={22} color="#7b5cd6" />}
                title="Load & scan"
                description="Scan every bag while loading the vehicle."
                onPress={() => router.push('/loading')}
              />
            </View>
          </View>

          {!orders || !jobs ? <ActivityIndicator className="mt-6" color="#0b218c" /> : null}
          <View className="h-28" />
        </View>
      </ScreenContainer>
    </>
  );
}
