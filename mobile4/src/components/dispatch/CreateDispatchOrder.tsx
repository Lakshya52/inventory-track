import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text, TextInput, Pressable, Modal, FlatList, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { CalendarDays, Check, ChevronDown, Minus, Phone, Plus } from 'lucide-react-native';

import { ScreenTitle } from '@/components/common/Primitives';
import { useAppData } from '@/contexts/AppDataContext';
import { useAsyncData } from '@/hooks/useAsyncData';
import { domainApi } from '@/services/domain';
import { WorkflowShell } from './WorkflowShell';

interface AvailableLabel {
  id: number;
  batch_id: number;
  qr_value: string;
  serial_no: number;
}

export function CreateDispatchOrder() {
  const { clients, refresh: refreshAppData } = useAppData();
  const { data: groups, isLoading, isRefreshing, refresh } = useAsyncData(domainApi.eligibleBatches);
  const [clientId, setClientId] = useState<string | number | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [batch, setBatch] = useState<Record<string, unknown> | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [labels, setLabels] = useState<AvailableLabel[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [container, setContainer] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refresh(), refreshAppData()]);
  }, [refresh, refreshAppData]);

  const eligible = (groups?.children ?? []).filter((row) => {
    const remaining = Number(row.available_quantity ?? row.quantity ?? 0);
    return remaining > 0 && row.qr_printed === true;
  });

  const client = clients.find((c) => c.id === clientId);

  const selectBatch = async (row: Record<string, unknown>) => {
    setBatch(row);
    setBatchOpen(false);
    setQuantity(1);
    try {
      const data = await domainApi.availableLabels(String(row.id));
      setLabels(data);
    } catch {
      setLabels([]);
      Alert.alert('No labels', 'No printed labels are available for this batch.');
    }
  };

  const submit = async () => {
    if (!clientId || !batch) {
      Alert.alert('Missing selection', 'Select a client and a batch.');
      return;
    }
    if (!driverName.trim() || !driverPhone.trim() || !vehicle.trim() || !container.trim()) {
      Alert.alert('Missing transporter details', 'All transporter fields are required.');
      return;
    }
    if (labels.length === 0) {
      Alert.alert('No labels', 'This batch has no available printed labels.');
      return;
    }
    setBusy(true);
    try {
      await domainApi.createDispatchOrder({
        client_id: clientId,
        items: [{ batch_id: batch.id, quantity, label_ids: labels.slice(0, quantity).map((l) => l.id) }],
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim(),
        vehicle_number: vehicle.trim(),
        container_number: container.trim(),
        scheduled_dispatch_at: scheduled ? new Date(scheduled).toISOString() : new Date().toISOString(),
      });
      Alert.alert('Order created', 'The dispatch order is ready to load.');
      router.push('/dispatch');
    } catch (cause) {
      Alert.alert('Order failed', cause instanceof Error ? cause.message : 'Unable to create order.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkflowShell refreshing={isRefreshing} onRefresh={refreshAll}>
      <ScreenTitle>{'Create Dispatch\nOrder'}</ScreenTitle>

      <View className="mt-7">
        <Text className="text-sm font-lexend-semibold text-ink">1. Select Client / Party / Customer</Text>
        <Pressable
          onPress={() => setClientOpen(true)}
          className="mt-3 h-12 flex-row items-center justify-between rounded-xl bg-[#eef1f7] px-4">
          <Text className="font-lexend text-ink">{client?.name ?? 'Search Or Select Party'}</Text>
          <ChevronDown size={18} color="#65718c" />
        </Pressable>
      </View>

      <View className="mt-6">
        <Text className="text-sm font-lexend-semibold text-ink">2. Select Available Batches</Text>
        <Pressable
          onPress={() => setBatchOpen(true)}
          className="mt-3 h-12 flex-row items-center justify-between rounded-xl bg-[#eef1f7] px-4">
          <Text className="font-lexend text-ink">{String(batch?.batch_number ?? 'Search Product Or Batch')}</Text>
          <ChevronDown size={18} color="#65718c" />
        </Pressable>

        {batch ? (
          <View className="mt-3 rounded-2xl border border-[#0ba178] bg-canvas p-3">
            <View className="flex-row items-center gap-2">
              <View className="h-5 w-5 items-center justify-center rounded bg-brand">
                <Check size={14} color="#ffffff" />
              </View>
              <View className="flex-1">
                <Text className="text-xs font-lexend-semibold text-ink">{String(batch.product_name ?? '')}</Text>
                <Text className="text-[10px] font-lexend text-muted">{String(batch.batch_number ?? '')}</Text>
              </View>
            </View>
            <View className="mt-3 flex-row items-center gap-3">
              <Pressable onPress={() => setQuantity((q) => Math.max(1, q - 1))} className="h-8 w-8 items-center justify-center rounded-lg border border-[#dfe3ee]">
                <Minus size={14} color="#14204b" />
              </Pressable>
              <Text className="text-sm font-lexend-semibold text-ink">{quantity} bag(s)</Text>
              <Pressable
                onPress={() => setQuantity((q) => Math.min(labels.length, q + 1))}
                className="h-8 w-8 items-center justify-center rounded-lg border border-[#dfe3ee]">
                <Plus size={14} color="#14204b" />
              </Pressable>
              <Text className="ml-auto text-[10px] font-lexend text-muted">{labels.length} labels available</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View className="mt-6 border-t border-line pt-5">
        <Text className="text-base font-lexend-semibold text-ink">3. Transporter Details</Text>
        <Field label="TRANSPORTER NAME *" value={driverName} onChange={setDriverName} placeholder="e.g. Ramesh Transport Co." />
        <Field label="TRANSPORTER MOBILE NUMBER *" value={driverPhone} onChange={setDriverPhone} placeholder="e.g. 98765 43210" icon={<Phone size={18} color="#8e96ac" />} />
        <Field label="VEHICLE NUMBER *" value={vehicle} onChange={setVehicle} placeholder="e.g. MH-12-AB-1234" />
        <Field label="CONTAINER NUMBER *" value={container} onChange={setContainer} placeholder="e.g. CONT-9021" />
        <Field label="SCHEDULED DISPATCH *" value={scheduled} onChange={setScheduled} placeholder="YYYY-MM-DDTHH:mm" icon={<CalendarDays size={18} color="#65718c" />} />
      </View>

      {busy ? <ActivityIndicator className="mt-4" color="#0b218c" /> : null}
      <Pressable onPress={submit} disabled={busy} className="mt-6 h-12 items-center justify-center rounded-xl bg-[#0ba178]">
        <Text className="text-base font-lexend-semibold text-white">Create Order</Text>
      </Pressable>

      <PickerModal
        visible={clientOpen}
        title="Select Client"
        onClose={() => setClientOpen(false)}
        data={clients}
        keyExtractor={(item) => String(item.id)}
        renderLabel={(item) => item.name}
        onSelect={(item) => {
          setClientId(item.id);
          setClientOpen(false);
        }}
      />
      <PickerModal
        visible={batchOpen}
        title="Select Batch"
        onClose={() => setBatchOpen(false)}
        data={eligible}
        keyExtractor={(item) => String(item.id)}
        renderLabel={(item) => `${item.batch_number ?? ''} · ${item.product_name ?? ''}`}
        onSelect={selectBatch}
      />
      {isLoading ? <ActivityIndicator className="mt-2" color="#0b218c" /> : null}
    </WorkflowShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon?: ReactNode;
}) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-[11px] font-lexend-semibold tracking-wide text-[#65718c]">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        className="h-12 rounded-xl border border-[#dfe3ee] bg-canvas px-4 font-lexend text-ink"
      />
      {icon ? <View className="absolute bottom-3 right-3">{icon}</View> : null}
    </View>
  );
}

function PickerModal<T>({
  visible,
  title,
  onClose,
  data,
  keyExtractor,
  renderLabel,
  onSelect,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  data: T[];
  keyExtractor: (item: T) => string;
  renderLabel: (item: T) => string;
  onSelect: (item: T) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-canvas pt-12">
        <View className="flex-row items-center justify-between px-5 pb-3">
          <Text className="text-lg font-lexend-bold text-brand">{title}</Text>
          <Pressable onPress={onClose}>
            <Text className="text-sm font-lexend-semibold text-brand">Close</Text>
          </Pressable>
        </View>
        <FlatList
          data={data}
          keyExtractor={keyExtractor}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onSelect(item)}
              className="border-b border-[#e6e9f2] px-5 py-3">
              <Text className="text-sm font-lexend text-ink">{renderLabel(item)}</Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}
