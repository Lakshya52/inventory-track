import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  MapPin,
  Package,
  Plus,
  Search,
  Truck,
  UserRound,
  X,
  XCircle,
} from 'lucide-react-native';

import { AppText } from '@/components/ui/app-text';
import { BottomSheet, SheetInfoRow } from '@/components/ui/bottom-sheet';
import { PrimaryButton } from '@/components/ui/buttons';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { fetchClients, type Client } from '@/services/clients';
import { getAccessToken } from '@/services/api';
import { dispatchApi } from '@/services/dispatch';
import { useRole } from '@/context/role-context';
import type { DispatchBatch, DispatchOrder, PackingListData } from '@/types';

type OrderFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'DISPATCHED' | 'REJECTED';

export function DispatchOrdersScreen() {
  const router = useRouter();
  const { user } = useRole();
  const isAdmin = user?.role === 'admin';
  const canRaiseOrders = user?.role === 'dispatch';
  const canViewPackingLists = isAdmin || canRaiseOrders;
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<OrderFilter>('ALL');

  // Selected order details sheet
  const [selected, setSelected] = useState<DispatchOrder | null>(null);

  // Raise order modal state
  const [raiseVisible, setRaiseVisible] = useState(false);
  const [loadingRequestOptions, setLoadingRequestOptions] = useState(false);
  const [readyBatches, setReadyBatches] = useState<DispatchBatch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [containerNumber, setContainerNumber] = useState('');
  const [raising, setRaising] = useState(false);

  // Packing list modal state
  const [packingList, setPackingList] = useState<PackingListData | null>(null);
  const [packingLoading, setPackingLoading] = useState(false);

  // Action loading (starting loading session)
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const list = isAdmin ? await dispatchApi.allOrders() : await dispatchApi.myOrders();
      setOrders(list || []);
    } catch (err: any) {
      console.warn('Could not load dispatch orders:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    // This starts an async API fetch; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  const openRaiseModal = async () => {
    if (!canRaiseOrders) return;
    setRaiseVisible(true);
    setLoadingRequestOptions(true);
    setSelectedBatchId('');
    setSelectedClientId('');
    setDriverName('');
    setVehicleNumber('');
    setContainerNumber('');
    try {
      const [batchesList, clientsList] = await Promise.all([
        dispatchApi.readyBatches(),
        fetchClients(),
      ]);
      setReadyBatches(batchesList || []);
      setClients(clientsList?.filter((c) => {
        const isActive: unknown = c.is_active;
        return isActive == null || isActive === true || Number(isActive) === 1;
      }) || []);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not load batches or clients for dispatch request.');
    } finally {
      setLoadingRequestOptions(false);
    }
  };

  const handleRaiseSubmit = async () => {
    if (!canRaiseOrders) return;
    if (!selectedBatchId) {
      Alert.alert('Select Batch', 'Please select a QC-passed batch.');
      return;
    }
    if (!selectedClientId) {
      Alert.alert('Select Client', 'Please choose a destination client.');
      return;
    }
    if (!driverName.trim() || !vehicleNumber.trim() || !containerNumber.trim()) {
      Alert.alert('Incomplete Transport Info', 'Driver name, vehicle number, and container number are required.');
      return;
    }

    setRaising(true);
    try {
      await dispatchApi.raiseOrder({
        batch_id: selectedBatchId,
        client_id: selectedClientId,
        driver_name: driverName.trim(),
        vehicle_number: vehicleNumber.trim(),
        container_number: containerNumber.trim(),
      });

      Alert.alert(
        'Dispatch Order Raised',
        'Your dispatch request has been submitted and is pending QC approval.'
      );
      setRaiseVisible(false);
      void loadData();
    } catch (err: any) {
      Alert.alert('Could Not Raise Order', err?.message || 'Please check your inputs and try again.');
    } finally {
      setRaising(false);
    }
  };

  const handleViewPackingList = async (orderId: string | number) => {
    setPackingLoading(true);
    setPackingList(null);
    try {
      const data = await dispatchApi.getPackingList(orderId);
      setPackingList(data);
    } catch (err: any) {
      Alert.alert('Packing List Error', err?.message || 'Could not load packing list data.');
    } finally {
      setPackingLoading(false);
    }
  };

  const handleOpenPdf = async (orderId: string | number) => {
    try {
      const url = dispatchApi.packingListPdfUrl(orderId);
      const token = getAccessToken();
      if (!token) throw new Error('Your session has expired. Sign in again to download the packing list.');
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Could not download packing list (${response.status}).`);
      }
      const file = new File(Paths.cache, `packing-list-${orderId}-${Date.now()}.pdf`);
      await file.write(new Uint8Array(await response.arrayBuffer()));
      if (!(await Sharing.isAvailableAsync())) throw new Error('PDF sharing is not available on this device.');
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Packing list for order ${orderId}`,
      });
    } catch (err: any) {
      Alert.alert('Packing List PDF', err?.message || 'Could not download packing list PDF.');
    }
  };

  const handleStartLoading = async (order: DispatchOrder) => {
    setStartingSessionId(order.id);
    try {
      await dispatchApi.startLoadingSession(order.id);
      setSelected(null);
      // Navigate to scan tab
      router.push('/(dispatch)/scan-check');
    } catch (err: any) {
      // If session already exists, we can still navigate to scan tab to resume
      if (err?.code === 'SESSION_EXISTS' || err?.message?.includes('active loading session already exists')) {
        setSelected(null);
        router.push('/(dispatch)/scan-check');
      } else {
        Alert.alert('Could Not Start Loading', err?.message || 'Please check the order status.');
      }
    } finally {
      setStartingSessionId(null);
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const s = String(order.status || '').toUpperCase();
      if (filter === 'PENDING' && s !== 'PENDING') return false;
      if (filter === 'APPROVED' && s !== 'APPROVED' && s !== 'DISPATCH_APPROVED') return false;
      if (filter === 'DISPATCHED' && s !== 'CLOSED_DISPATCHED' && s !== 'DISPATCHED') return false;
      if (filter === 'REJECTED' && s !== 'REJECTED') return false;

      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        String(order.id).toLowerCase().includes(q) ||
        (order.batch_number && order.batch_number.toLowerCase().includes(q)) ||
        (order.product_name && order.product_name.toLowerCase().includes(q)) ||
        (order.client_name && order.client_name.toLowerCase().includes(q)) ||
        (order.driver_name && order.driver_name.toLowerCase().includes(q)) ||
        (order.vehicle_number && order.vehicle_number.toLowerCase().includes(q)) ||
        (order.container_number && order.container_number.toLowerCase().includes(q))
      );
    });
  }, [orders, filter, search]);

  const orderCounts = useMemo(() => {
    const statusOf = (order: DispatchOrder) => String(order.status || '').toUpperCase();
    return {
      pending: orders.filter((order) => statusOf(order) === 'PENDING').length,
      ready: orders.filter((order) => ['APPROVED', 'DISPATCH_APPROVED'].includes(statusOf(order))).length,
      completed: orders.filter((order) => ['CLOSED_DISPATCHED', 'DISPATCHED'].includes(statusOf(order))).length,
    };
  }, [orders]);

  const selectedBatchObj = useMemo(
    () => readyBatches.find((b) => String(b.id) === selectedBatchId) || null,
    [readyBatches, selectedBatchId]
  );

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#011A87']} />
        }>
        <View className="px-5 pt-6">
          <View className="flex-row items-center justify-between">
            <PageHeading title={isAdmin ? 'All Dispatch Orders' : 'Dispatch Orders'} subtitle={isAdmin ? 'Review dispatch activity across the team' : 'Track requests, packing lists & loading'} />
            {canRaiseOrders ? <Pressable
              accessibilityRole="button"
              accessibilityLabel="Request a dispatch order"
              disabled={loadingRequestOptions}
              onPress={openRaiseModal}
              className="flex-row items-center gap-1 rounded-full bg-navy px-3.5 py-2"
              style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}>
              <Plus size={15} color="#FFFFFF" strokeWidth={2.5} />
              <AppText className="text-[12px] text-white" style={{ fontFamily: 'Manrope_700Bold' }}>
                Request
              </AppText>
            </Pressable> : null}
          </View>

          <View className="mt-4 flex-row gap-2.5">
            <OrderSummary label="Pending QC" value={orderCounts.pending} tone="amber" />
            <OrderSummary label="Ready to load" value={orderCounts.ready} tone="blue" />
            <OrderSummary label="Completed" value={orderCounts.completed} tone="green" />
          </View>

          {/* Search bar */}
          <View className="mt-4 flex-row items-center rounded-xl border border-line bg-white px-3.5 py-2">
            <Search size={16} color="#8A98AC" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search batch, client, driver, vehicle..."
              placeholderTextColor="#8A98AC"
              className="ml-2 flex-1 font-manrope-medium text-[13px] text-navy"
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch('')}>
                <X size={15} color="#8A98AC" />
              </Pressable>
            ) : null}
          </View>

          {/* Filter Chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-3.5 -mx-5 px-5"
            contentContainerStyle={{ gap: 8 }}>
            {(
              [
                { id: 'ALL', label: 'All Orders' },
                { id: 'PENDING', label: 'Pending QC' },
                { id: 'APPROVED', label: 'Approved & Ready' },
                { id: 'DISPATCHED', label: 'Dispatched' },
                { id: 'REJECTED', label: 'Rejected' },
              ] as const
            ).map((chip) => {
              const active = filter === chip.id;
              return (
                <Pressable
                  key={chip.id}
                  onPress={() => setFilter(chip.id)}
                  className={`rounded-full px-3.5 py-1.5 border ${
                    active
                      ? 'border-navy bg-navy'
                      : 'border-[#D4E3FA] bg-white'
                  }`}>
                  <AppText
                    className={`text-[11.5px] ${active ? 'text-white font-manrope-bold' : 'text-[#4E5D76] font-manrope-medium'}`}>
                    {chip.label}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Orders List */}
          <View className="mt-5 gap-[14px]">
            {loading ? (
              <View className="items-center py-10">
                <AppText variant="caption">Loading dispatch orders...</AppText>
              </View>
            ) : filteredOrders.length === 0 ? (
              <View className="items-center rounded-2xl border border-dashed border-[#CCD7E6] bg-white px-6 py-12">
                <Package size={36} color="#9AA6B8" strokeWidth={1.5} />
                <AppText variant="h2" className="mt-3 text-[16px]">
                  No Orders Found
                </AppText>
                <AppText variant="caption" className="mt-1 text-center text-[11px]">
                  {search
                    ? 'No dispatch orders matched your search query.'
                    : filter === 'PENDING'
                      ? 'No dispatch requests currently waiting for QC approval.'
                      : filter === 'APPROVED'
                        ? 'No approved orders waiting to be loaded.'
                        : 'No orders recorded yet. Tap "+ Request" to create one.'}
                </AppText>
                {canRaiseOrders && (readyBatches.length > 0 || !search) ? (
                  <PrimaryButton
                    label="Raise New Dispatch Order"
                    icon={Plus}
                    size="md"
                    className="mt-4 px-4"
                    onPress={openRaiseModal}
                  />
                ) : null}
              </View>
            ) : (
              filteredOrders.map((order) => {
                const status = String(order.status || '').toUpperCase();
                const isApproved = status === 'APPROVED' || status === 'DISPATCH_APPROVED';
                const isRejected = status === 'REJECTED';
                const isPending = status === 'PENDING';
                const isDispatched = status === 'CLOSED_DISPATCHED' || status === 'DISPATCHED';

                return (
                  <Pressable
                    key={order.id}
                    onPress={() => setSelected(order)}
                    className="rounded-[14px] border border-[#D4E3FA] bg-white p-4"
                    style={({ pressed }) => (pressed ? { opacity: 0.9 } : undefined)}>
                    <View className="flex-row items-start gap-2">
                      <View className="min-w-0 flex-1 flex-row items-center gap-2">
                        <View className="h-8 w-8 items-center justify-center rounded-full bg-[#EBF3FF]">
                          <Truck size={16} color="#011A87" />
                        </View>
                        <View className="min-w-0 flex-1">
                          <AppText
                            className="text-[14px] text-navy"
                            numberOfLines={2}
                            ellipsizeMode="tail"
                            style={{ fontFamily: 'Manrope_800ExtraBold' }}>
                            Order #{order.id}
                          </AppText>
                          <AppText variant="tiny" className="text-[10px] text-[#71829B]">
                            Batch: {order.batch_number || 'N/A'}
                          </AppText>
                        </View>
                      </View>
                      <StatusBadge
                        status={status}
                        className="shrink-0"
                        label={
                          isPending
                            ? 'Pending QC'
                            : isApproved
                              ? 'Approved'
                              : isRejected
                                ? 'Rejected'
                                : isDispatched
                                  ? 'Dispatched'
                                  : status
                        }
                      />
                    </View>

                    <View className="mt-3 border-t border-line/60 pt-2.5">
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1 pr-2">
                          <AppText variant="tiny" className="text-[9px] uppercase tracking-wide text-[#71829B]">
                            Customer
                          </AppText>
                          <AppText variant="bodyDark" className="font-manrope-bold text-[12px]">
                            {order.client_name || 'N/A'}
                          </AppText>
                        </View>
                        <View className="flex-1 pl-2">
                          <AppText variant="tiny" className="text-[9px] uppercase tracking-wide text-[#71829B]">
                            Product / Quantity
                          </AppText>
                          <AppText variant="bodyDark" className="font-manrope-bold text-[12px]">
                            {order.product_name || 'Product'} · {order.quantity ?? '-'} {order.uom || 'units'}
                          </AppText>
                        </View>
                      </View>

                      <View className="mt-2 flex-row items-center justify-between">
                        <View className="flex-1 pr-2">
                          <AppText variant="tiny" className="text-[9px] uppercase tracking-wide text-[#71829B]">
                            Vehicle &amp; Container
                          </AppText>
                          <AppText variant="caption" className="font-manrope-medium text-[11px] text-[#293A54]">
                            {order.vehicle_number || '-'} · {order.container_number || '-'}
                          </AppText>
                        </View>
                        <View className="flex-1 pl-2">
                          <AppText variant="tiny" className="text-[9px] uppercase tracking-wide text-[#71829B]">
                            Driver
                          </AppText>
                          <AppText variant="caption" className="font-manrope-medium text-[11px] text-[#293A54]">
                            {order.driver_name || '-'}
                          </AppText>
                        </View>
                      </View>
                    </View>

                    {/* Quick action banners */}
                    {isApproved && canViewPackingLists ? (
                      <View className="mt-3 flex-row gap-2 border-t border-line/50 pt-2.5">
                        <Pressable
                          onPress={(event) => { event.stopPropagation(); void handleViewPackingList(order.id); }}
                          className="flex-1 flex-row items-center justify-center gap-1 rounded-lg bg-[#EBF3FF] py-2">
                          <FileText size={13} color="#011A87" />
                          <AppText className="text-[11px] text-navy font-manrope-bold">
                            Packing List
                          </AppText>
                        </Pressable>
                        {canRaiseOrders ? <Pressable
                          onPress={(event) => { event.stopPropagation(); void handleStartLoading(order); }}
                          className="flex-1 flex-row items-center justify-center gap-1 rounded-lg bg-navy py-2">
                          <Truck size={13} color="#FFFFFF" />
                          <AppText className="text-[11px] text-white font-manrope-bold">
                            Start Loading
                          </AppText>
                        </Pressable> : null}
                      </View>
                    ) : null}

                    {isRejected && (order.remarks || order.admin_remarks) ? (
                      <View className="mt-2.5 rounded-lg bg-[#FFF2F3] px-3 py-2 border border-[#FCD0D4]">
                        <AppText variant="tiny" className="text-[10px] text-[#C5222E] font-manrope-bold">
                          QC Remarks: {order.remarks || order.admin_remarks}
                        </AppText>
                      </View>
                    ) : null}

                    {isDispatched && order.seal_number ? (
                      <View className="mt-2.5 flex-row items-center gap-1.5 rounded-lg bg-[#F0FDF4] px-3 py-1.5 border border-[#BBF7D0]">
                        <CheckCircle2 size={13} color="#16A34A" />
                        <AppText variant="tiny" className="text-[10.5px] text-[#15803D] font-manrope-bold">
                          Seal #{order.seal_number} · Dispatched
                        </AppText>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      {/* Selected Order BottomSheet */}
      <BottomSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title="Dispatch Order Details">
        {selected ? (
          <>
            <View className="mb-3 rounded-2xl bg-navy p-4">
              <AppText className="text-[10px] font-manrope-bold uppercase tracking-[1.2px] text-blue-200">
                Order reference
              </AppText>
              <View className="mt-2 flex-row items-start justify-between gap-3">
                <AppText
                  className="min-w-0 flex-1 text-[18px] leading-[24px] text-white"
                  numberOfLines={2}
                  ellipsizeMode="middle"
                  style={{ fontFamily: 'Manrope_800ExtraBold' }}>
                  #{selected.id}
                </AppText>
                <StatusBadge status={selected.status} label={selected.status.replaceAll('_', ' ')} className="shrink-0" />
              </View>
            </View>

            <SheetInfoRow icon={UserRound} title="Customer / Client" subtitle={selected.client_name || 'N/A'} />
            <SheetInfoRow
              icon={Package}
              title="Product & Batch"
              subtitle={`${selected.product_name || 'Product'} · Batch ${selected.batch_number || 'N/A'} (${selected.quantity ?? '-'} ${selected.uom || 'units'})`}
            />
            <SheetInfoRow
              icon={Truck}
              title="Transport Details"
              subtitle={`Driver: ${selected.driver_name || '-'}\nVehicle: ${selected.vehicle_number || '-'}\nContainer: ${selected.container_number || '-'}`}
            />
            {selected.storage_location ? (
              <SheetInfoRow icon={MapPin} title="Storage Location" subtitle={selected.storage_location} />
            ) : null}
            <SheetInfoRow
              icon={Clock3}
              title="Created Date"
              subtitle={selected.created_at ? new Date(selected.created_at).toLocaleString() : 'N/A'}
            />

            {/* If Rejected: Show remarks prominently */}
            {selected.status === 'REJECTED' ? (
              <View className="my-2 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-3.5">
                <View className="flex-row items-center gap-1.5">
                  <XCircle size={16} color="#DC2626" />
                  <AppText className="text-[12px] text-[#B91C1C] font-manrope-bold">
                    Order Rejected by QC
                  </AppText>
                </View>
                <AppText className="mt-1 text-[11.5px] text-[#7F1D1D] font-manrope-medium">
                  {selected.remarks || selected.admin_remarks || 'No specific remarks provided.'}
                </AppText>
              </View>
            ) : null}

            {/* If Approved: Actions */}
            {canViewPackingLists && (selected.status === 'APPROVED' || selected.status === 'DISPATCH_APPROVED') ? (
              <View className="mt-2 gap-2">
                {canRaiseOrders ? <PrimaryButton
                  label="Start / Resume Loading"
                  icon={Truck}
                  onPress={() => handleStartLoading(selected)}
                  disabled={startingSessionId === selected.id}
                /> : null}
                <PrimaryButton
                  label="View Packing List"
                  icon={FileText}
                  variant="outline"
                  onPress={() => handleViewPackingList(selected.id)}
                />
              </View>
            ) : null}

            {/* If Dispatched / Closed */}
            {selected.status === 'CLOSED_DISPATCHED' || selected.status === 'CLOSED_NOT_DISPATCHED' ? (
              <View className="my-2 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-3.5">
                <View className="flex-row items-center justify-between">
                  <AppText className="text-[12px] text-[#15803D] font-manrope-bold">
                    Seal Number: {selected.seal_number || 'N/A'}
                  </AppText>
                  <StatusBadge
                    status={selected.outcome || selected.status}
                    label={selected.outcome || 'DISPATCHED'}
                  />
                </View>
                {selected.remarks ? (
                  <AppText className="mt-1 text-[11px] text-[#166534]">
                    Remarks: {selected.remarks}
                  </AppText>
                ) : null}
                <PrimaryButton
                  label="View Packing List"
                  icon={FileText}
                  variant="outline"
                  size="md"
                  className="mt-3"
                  onPress={() => handleViewPackingList(selected.id)}
                />
              </View>
            ) : null}

            <PrimaryButton
              label="Close"
              variant="soft"
              className="mt-3"
              onPress={() => setSelected(null)}
            />
          </>
        ) : null}
      </BottomSheet>

      {/* Raise Dispatch Order Modal */}
      <Modal visible={raiseVisible} transparent animationType="slide" onRequestClose={() => setRaiseVisible(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <Pressable className="flex-1" onPress={() => setRaiseVisible(false)} />
          <View className="max-h-[85%] rounded-t-[24px] bg-white px-5 pt-5 pb-8">
            <View className="flex-row items-center justify-between pb-3 border-b border-line">
              <View>
                <AppText variant="h2" className="text-[18px]">
                  Request Dispatch Order
                </AppText>
                <AppText variant="caption" className="text-[11px]">
                  Select a QC-passed batch & destination details
                </AppText>
              </View>
              <Pressable
                onPress={() => setRaiseVisible(false)}
                className="h-8 w-8 items-center justify-center rounded-full bg-canvas">
                <X size={17} color="#001A6E" />
              </Pressable>
            </View>

            <ScrollView className="mt-3" showsVerticalScrollIndicator={false}>
              {/* Batch selection */}
              <AppText variant="label" className="mb-1 text-[11px]">
                1. Select QC-Passed Batch *
              </AppText>
              {loadingRequestOptions ? (
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
                            isSel
                              ? 'border-navy bg-[#EBF3FF]'
                              : 'border-line bg-white'
                          }`}
                          style={{ minWidth: 160 }}>
                          <AppText className="text-[13px] font-manrope-bold text-navy">
                            {b.batch_number}
                          </AppText>
                          <AppText variant="caption" className="mt-0.5 text-[10.5px]">
                            {b.product_name}
                          </AppText>
                          <AppText variant="tiny" className="mt-1 text-[9.5px] text-[#71829B]">
                            Qty: {b.quantity} {b.uom || 'units'}
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
                3. Transport &amp; Delivery Details *
              </AppText>
              <View className="gap-2.5 mb-4">
                <TextInput
                  value={driverName}
                  onChangeText={setDriverName}
                  placeholder="Driver Full Name *"
                  placeholderTextColor="#8A98AC"
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
              </View>

              <PrimaryButton
                label={raising ? 'Submitting...' : 'Submit Dispatch Request'}
                disabled={raising || loadingRequestOptions || !selectedBatchId || !selectedClientId}
                onPress={handleRaiseSubmit}
                className="mt-2"
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Packing List Modal */}
      <Modal visible={packingList !== null || packingLoading} transparent animationType="slide" onRequestClose={() => setPackingList(null)}>
        <View className="flex-1 justify-end bg-black/40">
          <Pressable className="flex-1" onPress={() => { if (!packingLoading) setPackingList(null); }} />
          <View className="max-h-[85%] rounded-t-[24px] bg-white px-5 pt-5 pb-8">
            <View className="flex-row items-center justify-between pb-3 border-b border-line">
              <View>
                <AppText variant="h2" className="text-[18px]">
                  {packingLoading ? 'Loading packing list' : 'Packing List'}
                </AppText>
                <AppText variant="caption" className="text-[11px]">
                  {packingList ? `Order #${packingList.order_id} · Frozen Snapshot` : 'Please wait while we retrieve the approved order'}
                </AppText>
              </View>
              <Pressable
                onPress={() => { if (!packingLoading) setPackingList(null); }}
                disabled={packingLoading}
                className="h-8 w-8 items-center justify-center rounded-full bg-canvas">
                <X size={17} color="#001A6E" />
              </Pressable>
            </View>

            <ScrollView className="mt-3" showsVerticalScrollIndicator={false}>
              {packingLoading ? (
                <View className="items-center justify-center py-12">
                  <ActivityIndicator size="large" color="#011A87" />
                  <AppText variant="caption" className="mt-3 text-[11px]">Preparing the frozen packing snapshot…</AppText>
                </View>
              ) : packingList ? (
                <>
              <View className="rounded-xl bg-canvas p-3 border border-line mb-4">
                <AppText className="text-[12px] font-manrope-bold text-navy">
                  Customer: {packingList?.client_name || 'N/A'}
                </AppText>
                <AppText variant="caption" className="mt-1 text-[11px] text-[#4E5D76]">
                  Driver: {packingList?.driver_name || '-'} | Vehicle: {packingList?.vehicle_number || '-'} | Container: {packingList?.container_number || '-'}
                </AppText>
                {packingList?.seal_number ? (
                  <AppText variant="caption" className="mt-1 text-[11px] font-manrope-bold text-[#15803D]">
                    Seal #{packingList.seal_number}
                  </AppText>
                ) : null}
              </View>

              <AppText variant="label" className="mb-2 text-[11px]">
                Line Items
              </AppText>
              {packingList?.items?.map((item, idx) => (
                <View key={idx} className="mb-2.5 rounded-xl border border-line bg-white p-3">
                  <View className="flex-row items-center justify-between">
                    <AppText className="text-[13px] font-manrope-bold text-navy">
                      {item.product_name || 'Product'}
                    </AppText>
                    <AppText className="text-[12px] font-manrope-bold text-navy">
                      {item.quantity ?? '-'} {item.uom || 'units'}
                    </AppText>
                  </View>
                  <AppText variant="caption" className="mt-0.5 text-[11px]">
                    Batch #{item.batch_number} · Location: {item.location_code || item.location || 'Warehouse'}
                  </AppText>
                </View>
              ))}

              <View className="mt-4 gap-2">
                <PrimaryButton
                  label="Open Print-Ready PDF"
                  icon={Download}
                  onPress={() => packingList?.order_id && handleOpenPdf(packingList.order_id)}
                />
                <PrimaryButton
                  label="Close"
                  variant="outline"
                  onPress={() => setPackingList(null)}
                />
              </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function OrderSummary({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'blue' | 'green' }) {
  const styles = {
    amber: 'border-[#F2E0BB] bg-[#FFFAF0] text-[#9A650B]',
    blue: 'border-[#D1E1F8] bg-[#F4F8FF] text-navy',
    green: 'border-[#C8EBD7] bg-[#F5FCF8] text-[#126B3C]',
  }[tone];
  return (
    <View className={`min-w-0 flex-1 rounded-xl border px-3 py-3 ${styles}`}>
      <AppText className={`text-[19px] font-manrope-extrabold ${tone === 'amber' ? 'text-[#9A650B]' : tone === 'green' ? 'text-[#126B3C]' : 'text-navy'}`}>
        {value}
      </AppText>
      <AppText variant="tiny" className="mt-0.5 text-[9.5px]" numberOfLines={1}>{label}</AppText>
    </View>
  );
}
