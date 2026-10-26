import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { getActiveClients, getBatchesByStatus, getDispatchOrders, queueDispatchOrderRequests } from '../db/database';
import { newOperationId } from '../auth/authStorage';
import { Badge, Button, Card, EmptyState, Field, KeyValue, LoadingView, Screen, SectionHeader } from '../components/ui';
import type { EntityId } from '../types';
import { colors, spacing } from '../theme';
import LimitedAccessScreen from './LimitedAccessScreen';

function listOf(value: any): any[] {
  return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.orders) ? value.orders : [];
}
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

export default function OrdersScreen() {
  const { session } = useAuth();
  const { online, sync } = useSync();
  const role = session?.user.role;
  const [segment, setSegment] = useState(role === 'DISPATCH' ? 'ready' : 'pending');
  const [orders, setOrders] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<EntityId | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [clientId, setClientId] = useState<EntityId | null>(null);
  const [driver, setDriver] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [container, setContainer] = useState('');
  const [remarks, setRemarks] = useState('');
  const [packing, setPacking] = useState<any>(null);

  const load = useCallback(async () => {
    if (role !== 'ADMIN' && role !== 'DISPATCH') {
      setLoading(false);
      return;
    }
    try {
      if (role === 'DISPATCH') {
        if (segment === 'ready') {
          const [ready, clientRows] = online
            ? await Promise.all([api.dispatch.ready(), api.clients.list()])
            : await Promise.all([getBatchesByStatus(['QC_PASSED', 'DISPATCH_REJECTED'], 200), getActiveClients()]);
          setBatches(listOf(ready)); setClients(clientRows || []);
        } else {
          setOrders(online ? listOf(await api.dispatchOrders.mine()) : await getDispatchOrders());
        }
      } else {
        setOrders(listOf(segment === 'pending' ? await api.dispatchOrders.pending() : await api.dispatchOrders.all(segment === 'all' ? undefined : segment.toUpperCase())));
      }
    } catch (error: any) {
      Alert.alert('Could not load orders', error?.message || 'Check your connection and refresh.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [role, segment, online]);
  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));

  const openRaise = (batch: any) => {
    setSelectedBatch(batch); setClientId(null); setDriver(''); setVehicle(''); setContainer(''); setRemarks('');
  };
  const raise = async () => {
    if (!selectedBatch || !clientId || !driver.trim() || !vehicle.trim() || !container.trim()) {
      Alert.alert('Complete dispatch details', 'Choose a client and enter the driver, vehicle and container details.'); return;
    }
    setBusyId(selectedBatch.id ?? selectedBatch._id);
    try {
      if (online) {
        await api.dispatchOrders.raise({
          batch_id: selectedBatch.id ?? selectedBatch._id,
          barcode_value: selectedBatch.barcode_value,
          client_id: clientId,
          driver_name: driver.trim(),
          vehicle_number: vehicle.trim(),
          container_number: container.trim(),
        });
      } else if (session) {
        const operationId = newOperationId();
        await queueDispatchOrderRequests([{
          operation_id: operationId, local_id: `local:${operationId}`, batch: selectedBatch,
          raised_by: session.user.id, client_id: clientId, client_name: clients.find((item) => String(item.id ?? item._id) === String(clientId))?.name || '',
          driver_name: driver.trim(), vehicle_number: vehicle.trim(), container_number: container.trim(),
        }]);
      }
      setSelectedBatch(null); setSegment('mine');
      if (!online) await sync();
      Alert.alert(online ? 'Request sent' : 'Saved on this device', online
        ? 'The dispatch request is now waiting for approval.'
        : 'The dispatch request is queued locally and will sync when your connection returns.');
    } catch (error: any) { Alert.alert('Could not raise request', error?.message || 'Please try again.'); }
    finally { setBusyId(null); }
  };

  const decide = async (order: any, approved: boolean) => {
    const id = order.id ?? order._id;
    const action = async () => {
      setBusyId(id);
      try {
        if (approved) await api.dispatchOrders.approve(id, remarks.trim() || undefined);
        else await api.dispatchOrders.reject(id, remarks.trim() || undefined);
        setRemarks(''); await load();
      } catch (error: any) { Alert.alert('Could not update request', error?.message || 'Please try again.'); }
      finally { setBusyId(null); }
    };
    if (approved) { await action(); return; }
    Alert.alert('Reject dispatch request?', `Request for ${order.batch_number || 'this batch'} will be returned to the dispatch team.`, [
      { text: 'Keep request', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => { void action(); } },
    ]);
  };

  const showPackingList = async (order: any) => {
    try { setPacking(await api.dispatchOrders.packingList(order.id ?? order._id)); }
    catch (error: any) { Alert.alert('Could not load packing list', error?.message || 'Please try again.'); }
  };

  const printPackingList = async () => {
    if (!packing) return;
    const items = Array.isArray(packing.items) ? packing.items : [];
    const columns: [string, string][] = [
      ['Product', 'product_name'], ['SKU', 'sku'], ['Batch', 'batch_number'],
      ['Barcode', 'barcode'], ['Quantity', 'quantity'], ['Grade', 'grade'], ['Location', 'location'],
    ];
    const htmlRows = items.map((item: any) => `<tr>${columns.map(([, key]) => `<td>${escapeHtml(item[key])}</td>`).join('')}</tr>`).join('');
    const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}h1{font-size:22px}p{color:#475569;font-size:12px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:18px 0}.meta div{padding:9px;background:#f1f5f9;border-radius:6px;font-size:12px}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left;vertical-align:top}th{background:#f1f5f9}</style></head><body><h1>Packing list</h1><p>${escapeHtml(packing.batch_number || '')} · ${escapeHtml(packing.status || '')}</p><div class="meta">${[
      ['Client', packing.client_name || packing.client?.name], ['Driver', packing.driver_name],
      ['Vehicle', packing.vehicle_number], ['Container', packing.container_number],
      ['Location', packing.location], ['Dispatched by', packing.dispatched_by],
      ['Dispatched at', packing.dispatched_at],
    ].map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><br/>${escapeHtml(value || '—')}</div>`).join('')}</div><table><thead><tr>${columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${htmlRows}</tbody></table>${packing.admin_remarks ? `<p>Review note: ${escapeHtml(packing.admin_remarks)}</p>` : ''}</body></html>`;
    await Print.printAsync({ html });
  };

  const packingItems = Array.isArray(packing?.items) ? packing.items : [];

  if (role === 'QC') return <LimitedAccessScreen />;
  if (loading && orders.length === 0 && batches.length === 0) return <Screen><LoadingView label="Loading dispatch orders…" /></Screen>;
  const admin = role === 'ADMIN';

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        <SectionHeader title="Dispatch orders" subtitle={admin ? 'Review dispatch requests and update approvals.' : online ? 'Raise a dispatch request or track your requests.' : 'Offline requests stay on this device and sync automatically.'} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segments}>
          {(admin ? [['pending', 'Pending'], ['all', 'All orders']] : [['ready', 'Ready to request'], ['mine', 'My requests']]).map(([key, label]) => (
            <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: segment === key }} onPress={() => setSegment(key)} style={[styles.segment, segment === key && styles.segmentActive]}>
              <Text style={[styles.segmentText, segment === key && styles.segmentTextActive]}>{label}</Text>
            </Pressable>
          ))}
          {admin && segment === 'all' ? ['pending', 'approved', 'rejected'].map((status) => <Pressable key={status} accessibilityRole="tab" accessibilityState={{ selected: segment === status }} onPress={() => setSegment(status)} style={[styles.segment, segment === status && styles.segmentActive]}><Text style={[styles.segmentText, segment === status && styles.segmentTextActive]}>{status}</Text></Pressable>) : null}
        </ScrollView>

        {role === 'DISPATCH' && segment === 'ready' ? (batches.length ? batches.map((batch) => (
          <Card key={String(batch.id ?? batch._id)} style={styles.row}>
            <View style={styles.main}>
              <Text style={styles.title}>{batch.product_name || batch.product?.name}</Text>
              <Text style={styles.meta}>{batch.batch_number} · {batch.quantity} {batch.uom || 'units'}</Text>
              <Text style={styles.meta}>{batch.location_code || batch.storage_location || 'Location not set'}</Text>
            </View>
            <Button title="Request" small onPress={() => openRaise(batch)} />
          </Card>
        )) : <EmptyState title="No batches ready for dispatch" message="QC-passed batches will appear here when available." />) : null}

        {!(role === 'DISPATCH' && segment === 'ready') ? (orders.length ? orders.map((order) => {
          const id = order.id ?? order._id;
          return <Card key={String(id)} style={styles.order}>
            <View style={styles.orderHeader}>
              <View style={styles.main}><Text style={styles.title}>{order.product_name || 'Dispatch request'}</Text><Text style={styles.meta}>{order.batch_number} · {order.quantity} {order.uom || 'units'}</Text></View>
              <Badge status={order.status || 'PENDING'} />
            </View>
            <View style={styles.detailGrid}>
              <Text style={styles.detail}>Client: {order.client_name || order.client?.name || '—'}</Text>
              <Text style={styles.detail}>Driver: {order.driver_name || '—'} · Vehicle: {order.vehicle_number || '—'}</Text>
              {order.container_number ? <Text style={styles.detail}>Container: {order.container_number}</Text> : null}
              {!!order.admin_remarks && <Text style={styles.detail}>Review note: {order.admin_remarks}</Text>}
            </View>
            <View style={styles.actions}>
              {admin && order.status === 'PENDING' ? <>
                <Button title="Approve" small onPress={() => void decide(order, true)} loading={busyId === id} style={{ flex: 1 }} />
                <Button title="Reject" small variant="danger" onPress={() => void decide(order, false)} style={{ flex: 1 }} />
              </> : null}
              {role === 'DISPATCH' && (order.status === 'APPROVED' || order.dispatched_at) ? <Button title="Packing list" small variant="secondary" onPress={() => void showPackingList(order)} /> : null}
            </View>
          </Card>;
        }) : <EmptyState title={segment === 'pending' ? 'No requests waiting' : 'No orders yet'} message="Pull down to refresh the latest server data." />) : null}
      </ScrollView>

      <Modal visible={!!selectedBatch} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedBatch(null)}>
        <Screen edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.modal} keyboardShouldPersistTaps="handled">
            <SectionHeader title="Raise dispatch request" subtitle={`${selectedBatch?.batch_number || ''} · ${selectedBatch?.product_name || ''}`} right={<Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton} onPress={() => setSelectedBatch(null)}><Ionicons name="close" size={22} color={colors.text} /></Pressable>} />
            <Text style={styles.label}>Client</Text>
            <View style={styles.clientList}>{clients.map((client) => <Pressable key={String(client.id ?? client._id)} accessibilityRole="radio" accessibilityState={{ selected: String(clientId) === String(client.id ?? client._id) }} onPress={() => setClientId(client.id ?? client._id)} style={[styles.clientChip, String(clientId) === String(client.id ?? client._id) && styles.clientSelected]}><Text style={[styles.segmentText, String(clientId) === String(client.id ?? client._id) && styles.segmentTextActive]}>{client.name}</Text></Pressable>)}</View>
            <Field label="Driver name" value={driver} onChangeText={setDriver} />
            <Field label="Vehicle number" value={vehicle} onChangeText={setVehicle} autoCapitalize="characters" />
            <Field label="Container number" value={container} onChangeText={setContainer} autoCapitalize="characters" />
            <Button title={busyId ? 'Sending…' : 'Send for approval'} loading={!!busyId} onPress={() => void raise()} />
          </ScrollView>
        </Screen>
      </Modal>

      <Modal visible={!!packing} animationType="slide" onRequestClose={() => setPacking(null)}>
        <Screen edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.modal}>
            <SectionHeader title="Packing list" subtitle="Server-generated order details" right={<Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton} onPress={() => setPacking(null)}><Ionicons name="close" size={22} color={colors.text} /></Pressable>} />
            <Card style={styles.packingSummary}>
              <View style={styles.packingIntro}>
                <Ionicons name="cube-outline" size={21} color={colors.primary} />
                <View style={styles.main}>
                  <Text style={styles.title}>{packing.client_name || packing.client?.name || 'Dispatch shipment'}</Text>
                  <Text style={styles.meta}>{packing.batch_number || 'Packing details'} · {packing.status || '—'}</Text>
                </View>
              </View>
              <KeyValue label="Driver" value={packing.driver_name} />
              <KeyValue label="Vehicle" value={packing.vehicle_number} />
              <KeyValue label="Container" value={packing.container_number} />
              <KeyValue label="Location" value={packing.location} />
              <KeyValue label="Dispatched by" value={packing.dispatched_by} />
              <KeyValue label="Dispatched at" value={packing.dispatched_at} />
              {packing.admin_remarks ? <Text style={styles.detail}>Review note: {packing.admin_remarks}</Text> : null}
            </Card>
            <SectionHeader title="Items" subtitle={`${packingItems.length} item${packingItems.length === 1 ? '' : 's'} in this shipment`} />
            {packingItems.length ? packingItems.map((item: any, index: number) => (
              <Card key={String(item.id ?? `${item.batch_number ?? 'item'}-${index}`)} style={styles.packingItem}>
                <View style={styles.orderHeader}>
                  <View style={styles.main}>
                    <Text style={styles.title}>{item.product_name || 'Product'}</Text>
                    <Text style={styles.meta}>{item.batch_number || 'Batch not listed'}{item.sku ? ` · ${item.sku}` : ''}</Text>
                  </View>
                  <Badge status="DISPATCHED" label={`${item.quantity ?? '—'} ${item.uom || ''}`.trim()} />
                </View>
                <KeyValue label="Barcode" value={item.barcode} />
                <KeyValue label="Grade" value={item.grade} />
                <KeyValue label="Bag quantity" value={item.bag_quantity ? `${item.bag_quantity} ${item.bag_quantity_unit || ''}`.trim() : null} />
                <KeyValue label="Location" value={item.location} />
              </Card>
            )) : <EmptyState title="No packing items returned" message="Refresh the order and try opening its packing list again." />}
            <Button title="Print packing list" onPress={() => void printPackingList()} />
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 42 },
  segments: { gap: 8, paddingVertical: 2 },
  segment: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { color: colors.textMuted, fontWeight: '700', fontSize: 12, textTransform: 'capitalize' },
  segmentTextActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  main: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '800', color: colors.text },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  order: { gap: spacing.sm },
  orderHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailGrid: { gap: 4, paddingTop: 5 },
  detail: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  modal: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  packingSummary: { gap: spacing.xs },
  packingIntro: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  packingItem: { gap: spacing.xs },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  clientList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  clientChip: { minHeight: 44, justifyContent: 'center', borderRadius: 20, borderColor: colors.border, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12 },
  clientSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
