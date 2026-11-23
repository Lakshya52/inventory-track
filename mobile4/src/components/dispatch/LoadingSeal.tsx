import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';

import { useLoading } from '@/contexts/LoadingContext';
import { domainApi } from '@/services/domain';

export function LoadingSeal() {
  const { activeSession } = useLoading();
  const [seal, setSeal] = useState('');
  const [busy, setBusy] = useState(false);

  const dispatch = async () => {
    if (!activeSession) {
      Alert.alert('No active session', 'Start loading before sealing a vehicle.');
      return;
    }
    if (!seal.trim()) {
      Alert.alert('Seal number required', 'Enter the seal number to continue.');
      return;
    }
    setBusy(true);
    try {
      const orders = await domainApi.dispatchOrders();
      const order = orders.find((o) => o.id === activeSession.order_id || o.id === activeSession.dispatch_order_id);
      await domainApi.finaliseSession(activeSession.id, {
        driver_name: String(order?.driver_name ?? 'Driver'),
        driver_phone: order?.driver_phone ? String(order.driver_phone) : undefined,
        vehicle_number: String(order?.vehicle_number ?? ''),
        container_number: String(order?.container_number ?? ''),
        seal_number: seal.trim(),
        outcome: 'DISPATCHED',
      });
      Alert.alert('Dispatch complete', 'The load has been finalised and dispatched.');
      router.push('/dispatch');
    } catch (cause) {
      Alert.alert('Dispatch failed', cause instanceof Error ? cause.message : 'Unable to finalise.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 justify-center bg-[#eef1f7] px-6">
      <View className="absolute inset-x-0 top-0 opacity-30" pointerEvents="none">
        <View className="px-6 pt-6">
          <View className="h-8 w-48 rounded-lg bg-[#cfd4e0]" />
          <View className="mt-6 h-12 rounded-xl bg-[#dfe3ee]" />
          <View className="mt-4 h-40 rounded-2xl bg-[#d9f3e8]" />
        </View>
      </View>

      <View className="w-full rounded-2xl border border-brand bg-canvas p-5 shadow-lg">
        <View className="flex-row items-start justify-between">
          <View>
            <Text className="text-base font-lexend text-ink">Order :</Text>
            <Text className="mt-1 text-lg font-lexend-bold text-ink">#{activeSession?.order_number ?? ''}</Text>
          </View>
          <Pressable onPress={() => router.back()} accessibilityLabel="Close">
            <X size={22} color="#14204b" />
          </Pressable>
        </View>

        <TextInput
          value={seal}
          onChangeText={setSeal}
          placeholder="Enter Seal Number"
          className="mt-5 h-11 rounded-lg bg-[#dfe1e7] px-4 font-lexend text-ink"
        />

        <View className="mt-4">
          <Text className="text-[10px] font-lexend text-muted">Vehicle: {String(activeSession?.product_name ?? '')}</Text>
          <Text className="text-[10px] font-lexend text-muted">Batch: {String(activeSession?.batch_number ?? '')}</Text>
        </View>

        {busy ? <ActivityIndicator className="mt-4" color="#0b218c" /> : null}
        <Pressable
          onPress={dispatch}
          disabled={busy}
          className="mt-5 h-11 items-center justify-center rounded-lg bg-[#0ba178]">
          <Text className="text-base font-lexend-semibold text-white">Mark Dispatched</Text>
        </Pressable>
      </View>
    </View>
  );
}
