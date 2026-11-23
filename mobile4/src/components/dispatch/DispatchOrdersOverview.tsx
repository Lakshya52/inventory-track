import { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ArrowRight, Plus } from 'lucide-react-native';
import { useCallback } from 'react';

import { AppHeader } from '@/components/layout/AppHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { KpiCard } from '@/components/common/KpiCard';
import { ScreenTitle, SectionHeading, StatusPill } from '@/components/common/Primitives';
import { useAsyncData } from '@/hooks/useAsyncData';
import { domainApi } from '@/services/domain';
import type { DispatchOrder } from '@/types/domain';

function label(status: string) {
  if (status === 'APPROVED') return 'Ready to load';
  if (status === 'CLOSED_DISPATCHED') return 'Dispatched';
  if (status === 'CANCELLED') return 'Cancelled';
  if (status === 'PENDING') return 'Pending';
  return status;
}

export function DispatchOrdersOverview() {
  const { data, isLoading, isRefreshing, error, reload, refresh } = useAsyncData(domainApi.dispatchOrders);
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const orders = useMemo(() => {
    const all = data ?? [];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((order) =>
      [order.order_number, order.batch_number, order.client_name, order.product_name]
        .some((value) => String(value ?? '').toLowerCase().includes(q)),
    );
  }, [data, query]);

  const approved = (data ?? []).filter((o) => o.status === 'APPROVED').length;
  const dispatched = (data ?? []).filter((o) => o.status === 'CLOSED_DISPATCHED').length;

  return (
    <>
      <AppHeader title="Dispatch orders" />
      <ScreenContainer edges={[]} scroll refreshing={isRefreshing} onRefresh={refresh}>
        <View className="px-5 pt-6">
          <ScreenTitle>{'All Dispatch\nOrders'}</ScreenTitle>

          <View className="mt-6 flex-row gap-3">
            <KpiCard value={String(data?.length ?? 0)} label="Total orders" />
            <KpiCard value={String(approved)} label="Ready to load" />
            <KpiCard value={String(dispatched)} label="Dispatched" highlight />
          </View>

          <Pressable
            onPress={() => router.push('/dispatch/create')}
            className="mt-6 h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-[#0ba178]">
            <Plus size={20} color="#ffffff" />
            <Text className="text-base font-lexend-semibold text-white">Create new batch</Text>
          </Pressable>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Dispatch Orders"
            className="mt-5 h-12 rounded-xl bg-[#eef1f7] px-4 font-lexend text-ink"
          />

          <View className="mt-7">
            <SectionHeading>Recent Orders</SectionHeading>
          </View>

          {isLoading ? (
            <ActivityIndicator className="mt-6" color="#0b218c" />
          ) : error ? (
            <Text className="mt-6 text-center text-sm text-red-600" onPress={reload}>{error}</Text>
          ) : (
            <View className="mt-3 overflow-hidden rounded-2xl border border-[#e6e9f2] bg-canvas">
              {orders.map((order, index) => (
                <Pressable
                  key={order.id}
                  onPress={() => router.push(`/dispatch/${order.id}`)}
                  className={`flex-row items-center gap-3 px-4 py-3 ${
                    index !== orders.length - 1 ? 'border-b border-[#e6e9f2]' : ''
                  }`}>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-xs font-lexend-semibold text-ink">Order #{order.order_number}</Text>
                      <StatusPill>{label(order.status)}</StatusPill>
                    </View>
                    <Text className="mt-1 text-[11px] font-lexend text-muted">
                      {order.client_name ?? 'Client'} · {order.quantity ?? 0} units
                    </Text>
                  </View>
                  <View className="h-8 w-8 items-center justify-center rounded-full bg-[#0ba178]">
                    <ArrowRight size={16} color="#ffffff" />
                  </View>
                </Pressable>
              ))}
              {orders.length === 0 ? <Text className="p-6 text-center text-sm text-muted">No orders found.</Text> : null}
            </View>
          )}

          <View className="h-28" />
        </View>
      </ScreenContainer>
    </>
  );
}
