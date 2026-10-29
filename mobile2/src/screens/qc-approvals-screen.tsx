import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { ClipboardCheck, RefreshCw } from 'lucide-react-native';

import { AppText } from '@/components/ui/app-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { PrimaryButton } from '@/components/ui/buttons';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { dispatchApi, type DispatchOrderRecord } from '@/services/dispatch';

export function QcApprovalsScreen() {
  const [orders, setOrders] = useState<DispatchOrderRecord[]>([]);
  const [selected, setSelected] = useState<DispatchOrderRecord | null>(null);
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setOrders(await dispatchApi.pendingOrders());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dispatch approvals.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Fetch approval queue on screen entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const decide = async (approve: boolean) => {
    if (!selected || saving) return;
    if (!approve && !remarks.trim()) {
      Alert.alert('Remarks required', 'Add a reason before rejecting this dispatch request.');
      return;
    }
    setSaving(true);
    try {
      if (approve) await dispatchApi.approve(selected.id, remarks.trim() || undefined);
      else await dispatchApi.reject(selected.id, remarks.trim());
      const completedId = selected.id;
      setSelected(null);
      setRemarks('');
      setOrders((current) => current.filter((order) => order.id !== completedId));
      Alert.alert(approve ? 'Request approved' : 'Request rejected', approve
        ? 'Dispatch can now start loading this order.'
        : 'The request was rejected and removed from the pending queue.');
    } catch (err) {
      Alert.alert('Could not update request', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} colors={["#011A87"]} />}
        showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-6">
          <View className="flex-row items-start justify-between gap-3">
            <PageHeading title="Dispatch Approvals" subtitle="Review requests raised by the dispatch team" />
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh approvals" onPress={() => void load(true)} className="mt-1 h-10 w-10 items-center justify-center rounded-xl bg-white">
              <RefreshCw size={17} color="#011A87" />
            </Pressable>
          </View>
          <View className="mt-5 rounded-2xl border border-[#D4E3FA] bg-white p-4">
            <View className="flex-row items-center gap-2">
              <ClipboardCheck size={18} color="#011A87" />
              <AppText className="text-[13px] font-manrope-bold text-navy">{orders.length} request{orders.length === 1 ? '' : 's'} awaiting review</AppText>
            </View>
            <AppText className="mt-1 text-[11px] leading-4 text-[#5B6980]">Approving makes the packing list available and lets dispatch begin loading.</AppText>
          </View>

          {error ? <AppText className="mt-4 rounded-xl bg-[#FFF2F3] p-3 text-[12px] text-[#B42332]">{error}</AppText> : null}
          {loading ? <View className="mt-8 items-center"><ActivityIndicator color="#011A87" /><AppText className="mt-2 text-[12px] text-[#68758A]">Loading requests…</AppText></View> : null}
          {!loading && !error && orders.length === 0 ? <View className="mt-5 items-center rounded-2xl border border-dashed border-[#C7D6EA] bg-white px-5 py-8"><ClipboardCheck size={24} color="#2A9D68" /><AppText className="mt-2 text-[13px] font-manrope-bold text-navy">All caught up</AppText><AppText className="mt-1 text-center text-[11px] leading-4 text-[#68758A]">New dispatch requests will appear here for review.</AppText></View> : null}
          <View className="mt-4 gap-3">
            {orders.map((order) => (
              <Pressable key={order.id} onPress={() => { setSelected(order); setRemarks(''); }} className="rounded-2xl border border-[#D4E3FA] bg-white p-4" style={({ pressed }) => pressed ? { opacity: 0.85 } : undefined}>
                <View className="flex-row items-start justify-between gap-2">
                  <View className="min-w-0 flex-1">
                    <AppText className="text-[14px] font-manrope-extrabold text-navy" numberOfLines={1}>Order #{order.id}</AppText>
                    <AppText className="mt-1 text-[12px] font-manrope-semibold text-[#27364D]" numberOfLines={1}>{order.product_name || 'Product'} · {order.batch_number || 'Batch'}</AppText>
                  </View>
                  <StatusBadge status={order.status} label="Pending" className="shrink-0" />
                </View>
                <AppText className="mt-2 text-[11px] leading-4 text-[#5B6980]" numberOfLines={2}>Client: {order.client_name || '—'} · Qty: {order.quantity ?? '—'} {order.uom || 'units'}</AppText>
                <AppText className="mt-1 text-[10px] text-[#8793A5]">Raised by {order.raised_by_name || 'Dispatch'} · Tap to review</AppText>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <BottomSheet visible={selected !== null} onClose={() => { if (!saving) setSelected(null); }} title="Review Dispatch Request">
        {selected ? <View>
          <View className="rounded-2xl bg-navy p-4">
            <AppText className="text-[10px] font-manrope-bold uppercase tracking-[1px] text-blue-200">Order #{selected.id}</AppText>
            <AppText className="mt-1 text-[17px] font-manrope-extrabold text-white">{selected.product_name || 'Product'}</AppText>
            <AppText className="mt-1 text-[11px] text-blue-100">Batch {selected.batch_number || '—'} · {selected.quantity ?? '—'} {selected.uom || 'units'}</AppText>
          </View>
          <View className="mt-3 gap-2 rounded-xl bg-canvas p-3">
            <Detail label="Client" value={selected.client_name} />
            <Detail label="Raised by" value={selected.raised_by_name} />
            <Detail label="Driver" value={selected.driver_name} />
            <Detail label="Vehicle" value={selected.vehicle_number} />
            <Detail label="Container" value={selected.container_number} />
          </View>
          <AppText className="mb-1 mt-4 text-[11px] font-manrope-bold text-navy">Remarks {selected ? '(required to reject)' : ''}</AppText>
          <TextInput value={remarks} onChangeText={setRemarks} editable={!saving} multiline textAlignVertical="top" placeholder="Optional for approval; required for rejection" className="min-h-[82px] rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-navy" />
          <PrimaryButton label={saving ? 'Saving…' : 'Approve Request'} icon={ClipboardCheck} disabled={saving} className="mt-3" onPress={() => void decide(true)} />
          <PrimaryButton label={saving ? 'Saving…' : 'Reject Request'} disabled={saving} variant="outline" className="mt-2 border-[#F3AAB2]" labelClassName="text-[#B42332]" onPress={() => void decide(false)} />
        </View> : null}
      </BottomSheet>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return <View className="flex-row justify-between gap-3"><AppText className="text-[11px] text-[#6B7789]">{label}</AppText><AppText className="min-w-0 flex-1 text-right text-[11px] font-manrope-semibold text-navy" numberOfLines={2}>{value || '—'}</AppText></View>;
}
