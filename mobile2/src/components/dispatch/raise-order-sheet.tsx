import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { fetchClients, type Client } from '@/services/clients';
import { dispatchApi } from '@/services/dispatch';
import type { DispatchBatch } from '@/types';

type RaiseOrderSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Called after the order is created, so the caller can refresh its list. */
  onRaised?: () => void;
};

/**
 * Raise a dispatch order: pick a QC-passed batch, the destination client and
 * the transport details. Shared by the dispatch dashboard and the admin
 * dispatches screen.
 */
export function RaiseOrderSheet({ visible, onClose, onRaised }: RaiseOrderSheetProps) {
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [readyBatches, setReadyBatches] = useState<DispatchBatch[]>([]];
  const [clients, setClients] = useState<Client[]>([]];
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [containerNumber, setContainerNumber] = useState('');
  const [scheduledDispatchAt, setScheduledDispatchAt] = useState<string>('');
  const [raising, setRaising] = useState(false);

  const selectedBatchObj = readyBatches.find((b) => String(b.id) === selectedBatchId) || null;

  const loadOptions = useCallback(async () => {
    try {
      const [batchesList, clientsList] = await Promise.all([
        dispatchApi.readyBatches(),
        fetchClients(),
      ]);
      setReadyBatches(batchesList || []);
      setClients(
        clientsList?.filter((c) => {
          const isActive: unknown = c.is_active;
          return isActive == null || isActive === true || Number(isActive) === 1;
        }) || [],
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not load batches or clients for the dispatch order.');
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    // The sheet is remounted each time it opens, so the form starts empty.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingOptions(true);
    void loadOptions();
  }, [visible, loadOptions]);

  const submit = async () => {
    if (!selectedBatchId) {
      Alert.alert('Select Batch', 'Please select a QC-passed batch.');
      return;
    }
    if (!selectedClientId) {
      Alert.alert('Select Client', 'Please choose a destination client.');
      return;
    }
    if (!driverName.trim() || !driverPhone.trim() || !vehicleNumber.trim() || !containerNumber.trim()) {
      Alert.alert(
        'Incomplete Transporter Details',
        'Transporter name, mobile number, vehicle number and container number are required.',
      );
      return;
    }
    if (!scheduledDispatchAt.trim()) {
      Alert.alert('Scheduled Dispatch', 'Please enter the scheduled dispatch date and time.');
      return;
    }

    setRaising(true);
    try {
      await dispatchApi.raiseOrder({
        batch_id: selectedBatchId,
        client_id: selectedClientId,
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim(),
        vehicle_number: vehicleNumber.trim(),
        container_number: containerNumber.trim(),
        scheduled_dispatch_at: scheduledDispatchAt.trim(),
      });
      Alert.alert(
        'Dispatch Order Created',
        'Your dispatch order is ready. Open Scan & Load to start scanning the QR labels.',
      );
      onClose();
      onRaised?.();
    } catch (err: any) {
      Alert.alert('Could Not Create Order', err?.message || 'Please check your inputs and try again.');
    } finally {
      setRaising(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="max-h-[85%] rounded-t-[24px] bg-white px-5 pt-5 pb-8">
          <View className="flex-row items-center justify-between pb-3 border-b border-line">
            <View>
              <AppText variant="h2" className="text-[18px]">
                New Dispatch Order
              </AppText>
              <AppText variant="caption" className="text-[11px]">
                Select a QC-passed batch & destination details
              </AppText>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="h-8 w-8 items-center justify-center rounded-full bg-canvas">
              <X size={17} color="#001A6E" />
            </Pressable>
          </View>

          <ScrollView className="mt-3" showsVerticalScrollIndicator={false}>
            {/* Batch selection */}
            <AppText variant="label" className="mb-1 text-[11px]">
              1. Select QC-Passed Batch *
            </AppText>
            {loadingOptions ? (
              <View className="mb-4 flex-row items-center gap-2 rounded-xl border border-[#D4E3FA] bg-[#F7FAFF] p-3">
                <ActivityIndicator size="small" color="#011A87" />
                <AppText variant="caption" className="text-[11px]">Loading eligible batches and clients…</AppText>
              </View>
            ) : readyBatches.length === 0 ? (
              <View className="mb-4 rounded-xl border border-[#FCD0D4] bg-[#FFF2F3] p-3">
                <AppText className="text-[11px] text-danger-text font-manrope-medium">
                  No QC-passed batches currently ready for dispatch.
                </AppText>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4 -mx-1 px-1">
                <View className="flex-row gap-2 py-1">
                  {readyBatches.map((b) => {
                    const isSel = selectedBatchId === String(b.id);
                    return (
                      <Pressable
                        key={b.id}
                        onPress={() => setSelectedBatchId(String(b.id))}
                        className={`rounded-xl border p-3 ${
                          isSel ? 'border-navy bg-[#EBF3FF]' : 'border-line bg-white'
                        }`}
                        style={{ minWidth: 160 }}>
                        <AppText className="text-[13px] font-manrope-bold text-navy">
                          {b.batch_number}
                        </AppText>
                        <AppText variant="caption" className="mt-0.5 text-[10.5px]">
                          {b.product_name}
                        </AppText>
                        <AppText variant="tiny" className="mt-1 text-[9.5px] text-[#71829B]">
                          Qty: {b.quantity} x {b.uom || 'units'}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {selectedBatchObj ? (
              <View className="mb-4 rounded-xl bg-canvas p-3 border border-line">
                <AppText variant="tiny" className="text-[10px] text-[#71829B] uppercase font-manrope-bold">
                  Selected Batch Info
                </AppText>
                <AppText className="text-[12px] font-manrope-bold text-navy mt-0.5">
                  {selectedBatchObj.batch_number} — {selectedBatchObj.product_name}
                </AppText>
                <AppText variant="caption" className="text-[11px] text-[#4E5D76]">
                  Grade: {selectedBatchObj.grade_name || 'Standard'} · Location: {selectedBatchObj.storage_location || selectedBatchObj.location_code || 'Warehouse'}
                </AppText>
              </View>
            ) : null}

            {/* Client selection */}
            <AppText variant="label" className="mb-1 text-[11px]">
              2. Select Client / Customer *
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4 -mx-1 px-1">
              <View className="flex-row gap-2 py-1">
                {clients.map((c) => {
                  const isSel = selectedClientId === String(c.id);
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setSelectedClientId(String(c.id))}
                      className={`rounded-xl border px-3 py-2 ${
                        isSel ? 'border-navy bg-[#EBF3FF]' : 'border-line bg-white'
                      }`}>
                      <AppText className={`text-[12px] ${isSel ? 'font-manrope-bold text-navy' : 'text-[#293A54]'}`}>
                        {c.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {/* Transport details */}
            <AppText variant="label" className="mb-1 text-[11px]">
              3. Transporter Details *
            </AppText>
            <View className="gap-2.5 mb-4">
              <TextInput
                value={driverName}
                onChangeText={setDriverName}
                placeholder="Transporter Name *"
                placeholderTextColor="#8A98AC"
                className="h-10 rounded-lg border border-line bg-white px-3 font-manrope-medium text-[12px] text-navy"
              />
              <TextInput
                value={driverPhone}
                onChangeText={setDriverPhone}
                placeholder="Transporter Mobile Number *"
                placeholderTextColor="#8A98AC"
                keyboardType="phone-pad"
                className="h-10 rounded-lg border border-line bg-white px-3 font-manrope-medium text-[12px] text-navy"
              />
              <TextInput
                value={vehicleNumber}
                onChangeText={setVehicleNumber}
                placeholder="Vehicle Number (e.g. MH-12-AB-1234) *"
                placeholderTextColor="#8A98AC"
                autoCapitalize="characters"
                className="h-10 rounded-lg border border-line bg-white px-3 font-manrope-medium text-[12px] text-navy"
              />
              <TextInput
                value={containerNumber}
                onChangeText={setContainerNumber}
                placeholder="Container Number (e.g. CONT-9021) *"
                placeholderTextColor="#8A98AC"
                autoCapitalize="characters"
                className="h-10 rounded-lg border border-line bg-white px-3 font-manrope-medium text-[12px] text-navy"
              />
              <TextInput
                value={scheduledDispatchAt}
                onChangeText={setScheduledDispatchAt}
                placeholder="Scheduled date & time (e.g. 2025-01-15T14:30)"
                placeholderTextColor="#8A98AC"
                keyboardType="date-time"
                className="h-10 rounded-lg border border-line bg-white px-3 font-manrope-medium text-[12px] text-navy"
              />
            </View>

            <PrimaryButton
              label={raising ? 'Creating…' : 'Create Dispatch Order'}
              disabled={raising || loadingOptions || !selectedBatchId || !selectedClientId}
              onPress={submit}
              className="mt-2"
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
