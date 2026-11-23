import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { ScreenTitle, TabSwitcher } from '@/components/common/Primitives';
import { useLoading } from '@/contexts/LoadingContext';
import { domainApi } from '@/services/domain';
import { WorkflowShell } from './WorkflowShell';

const CONDITIONS = ['DAMAGED', 'HOLD', 'RETURN_TO_STOCK'];

export function LoadingRecallType() {
  const { qr } = useLocalSearchParams<{ qr?: string }>();
  const { activeSession } = useLoading();
  const [qrValue, setQrValue] = useState(qr ?? '');
  const [condition, setCondition] = useState('DAMAGED');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (qr) setQrValue(qr);
  }, [qr]);

  const submit = async () => {
    if (!activeSession) {
      Alert.alert('No active session', 'Start loading before recalling a product.');
      return;
    }
    if (!qrValue.trim() || !reason.trim()) {
      Alert.alert('Missing details', 'QR code and reason are required.');
      return;
    }
    setBusy(true);
    try {
      const result = await domainApi.recallQr(activeSession.id, {
        qr_value: qrValue.trim(),
        condition,
        reason: reason.trim(),
      });
      Alert.alert('Product recalled', `${result.scanned}/${result.total} units loaded.`);
      router.push('/loading/scan');
    } catch (cause) {
      Alert.alert('Recall failed', cause instanceof Error ? cause.message : 'Unable to recall product.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkflowShell>
      <TabSwitcher active="recall" onScan={() => router.push('/loading/scan')} onRecall={() => router.push('/loading/recall')} />

      <View className="mt-6">
        <ScreenTitle>Recall A Product</ScreenTitle>
        <Text className="mt-2 text-sm font-lexend text-[#9aa1b4]">
          Enter QR code value or Scan a QR code to make the recall of the product
        </Text>
      </View>

      <View className="mt-5">
        <Text className="mb-2 text-sm font-lexend-semibold text-brand">Product QR Code</Text>
        <TextInput
          value={qrValue}
          onChangeText={setQrValue}
          className="h-12 rounded-xl border border-[#8f9bc8] bg-[#dfe1e7] px-4 font-lexend text-ink"
        />
      </View>

      <View className="mt-5">
        <Text className="mb-2 text-sm font-lexend-semibold text-brand">Condition</Text>
        <View className="flex-row gap-2">
          {CONDITIONS.map((item) => (
            <Pressable
              key={item}
              onPress={() => setCondition(item)}
              className={`flex-1 rounded-lg border px-2 py-3 ${
                condition === item ? 'border-brand bg-[#eef1f7]' : 'border-[#dfe3ee]'
              }`}>
              <Text className="text-center text-[10px] font-lexend-semibold text-brand">{item.replace('_', ' ')}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View className="mt-5">
        <Text className="mb-2 text-sm font-lexend-semibold text-brand">Reason</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          multiline
          className="h-20 rounded-xl border border-[#8f9bc8] bg-[#dfe1e7] px-4 py-3 font-lexend text-ink"
        />
      </View>

      {busy ? <ActivityIndicator className="mt-4" color="#0b218c" /> : null}
      <Pressable
        onPress={submit}
        disabled={busy}
        className="mt-7 h-12 items-center justify-center rounded-xl bg-[#0ba178]">
        <Text className="text-base font-lexend-semibold text-white">Recall Product</Text>
      </Pressable>
    </WorkflowShell>
  );
}
