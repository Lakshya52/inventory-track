import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { AppHeader } from '@/components/layout/AppHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { ScreenTitle } from '@/components/common/Primitives';
import { useLoading } from '@/contexts/LoadingContext';
import { useAsyncData } from '@/hooks/useAsyncData';
import { domainApi } from '@/services/domain';
import { LoadingOrderCard } from './LoadingParts';

export function LoadingOverview() {
  const { data: orders, isLoading, isRefreshing, error, reload, refresh } = useAsyncData(domainApi.dispatchOrders);
  const { sessions, selectSession, startSession } = useLoading();

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const approved = (orders ?? []).filter((order) => order.status === 'APPROVED');

  const start = async (orderId: string | number) => {
    try {
      const existing = sessions.find((s) => s.order_id === orderId || s.dispatch_order_id === orderId);
      if (existing) {
        selectSession(existing.id);
      } else {
        await startSession(orderId);
      }
      router.push('/loading/scan');
    } catch (cause) {
      Alert.alert('Unable to start loading', cause instanceof Error ? cause.message : 'Please try again.');
    }
  };

  return (
    <>
      <AppHeader title="Loading & Scanning" />
      <ScreenContainer edges={[]} scroll refreshing={isRefreshing} onRefresh={refresh}>
        <View className="px-5 pt-6">
          <ScreenTitle>Loading &amp; Scan</ScreenTitle>

          {isLoading ? (
            <ActivityIndicator className="mt-8" color="#0b218c" />
          ) : error ? (
            <Text className="mt-8 text-center text-sm text-red-600" onPress={reload}>{error}</Text>
          ) : (
            <View className="mt-5 gap-4">
              {approved.map((order) => (
                <LoadingOrderCard key={order.id} order={order} onStart={() => start(order.id)} />
              ))}
              {approved.length === 0 ? (
                <Text className="mt-6 text-center text-sm text-muted">No orders are ready to load.</Text>
              ) : null}
            </View>
          )}

          <View className="h-28" />
        </View>
      </ScreenContainer>
    </>
  );
}
