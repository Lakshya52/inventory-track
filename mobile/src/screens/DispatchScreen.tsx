import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { newOperationId } from '../auth/authStorage';
import {
  enqueueOperation,
  getBatchByBarcode,
  getBatchesByStatus,
  insertLocalDispatchOrder,
  queueBulkOperation,
  setBatchLocalStatus,
} from '../db/database';
import { Badge, Button, Card, EmptyState, Field, Screen, SectionHeader } from '../components/ui';
import { PhotoPicker } from '../components/PhotoPicker';
import { colors, radius, spacing } from '../theme';
import { formatAge } from '../utils/format';
import type { Batch } from '../types';

type MessageKind = 'success' | 'error' | 'info';

let localOrderSequence = 0;

function nextLocalOrderId(): number {
  localOrderSequence += 1;
  return -Date.now() - localOrderSequence;
}

export default function DispatchScreen() {
  const { session } = useAuth();
  const { online, pendingCount, syncing, sync } = useSync();
  const [permission, requestPermission] = useCameraPermissions();
  const [approved, setApproved] = useState<Batch[]>([]);
  const [ready, setReady] = useState<Batch[]>([]);
  const [group, setGroup] = useState<Batch[]>([]);
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<MessageKind>('info');
  const [submitting, setSubmitting] = useState(false);
  const [raisingId, setRaisingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const groupRef = useRef<Batch[]>([]);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  const load = useCallback(async () => {
    const [approvedRows, readyRows] = await Promise.all([
      getBatchesByStatus(['DISPATCH_APPROVED'], 200),
      getBatchesByStatus(['QC_PASSED'], 200),
    ]);
    setApproved(approvedRows);
    setReady(readyRows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const showMessage = (text: string, kind: MessageKind) => {
    setMessage(text);
    setMessageKind(kind);
  };

  const addBatch = useCallback((batch: Batch): boolean => {
    if (groupRef.current.some((item) => item.id === batch.id)) return false;
    if (groupRef.current.length >= 500) {
      showMessage('A dispatch group can contain at most 500 QR codes.', 'error');
      return false;
    }
    const next = [...groupRef.current, batch];
    groupRef.current = next;
    setGroup(next);
    return true;
  }, []);

  const addByBarcode = useCallback(async (value: string) => {
    const barcode = value.trim();
    if (!barcode) return;
    const batch = await getBatchByBarcode(barcode);
    if (!batch) {
      showMessage('That QR code is not on this device yet. Sync while online, then try again.', 'error');
      return;
    }
    if (batch.status !== 'DISPATCH_APPROVED') {
      if (batch.status === 'QC_PASSED') {
        showMessage('QC passed, but no approved dispatch order exists. Raise an order below first.', 'info');
      } else if (batch.status === 'DISPATCH_ORDER_RAISED') {
        showMessage('That dispatch order is still waiting for admin approval.', 'info');
      } else if (batch.status === 'DISPATCHED') {
        showMessage('That QR code has already been dispatched.', 'error');
      } else {
        showMessage(
          `${batch.batch_number} is ${batch.status.replace(/_/g, ' ').toLowerCase()} and cannot be dispatched.`,
          'error'
        );
      }
      return;
    }
    if (!addBatch(batch)) {
      showMessage('That QR code is already in this dispatch group.', 'info');
      return;
    }
    setManual('');
    showMessage(
      `${batch.batch_number} added. ${groupRef.current.length} approved code${groupRef.current.length === 1 ? '' : 's'} ready.`,
      'success'
    );
  }, [addBatch]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.value === data && now - lastScanRef.current.at < 2000) {
      return;
    }
    lastScanRef.current = { value: data, at: now };
    void addByBarcode(data);
  }, [addByBarcode]);

  const startScanning = async () => {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) {
        Alert.alert('Camera permission required', 'Allow camera access to scan approved QR labels.');
        return;
      }
    }
    setScanning(true);
  };

  const removeBatch = (batchId: number) => {
    const next = groupRef.current.filter((batch) => batch.id !== batchId);
    groupRef.current = next;
    setGroup(next);
  };

  const toggleBatch = (batch: Batch) => {
    if (groupRef.current.some((item) => item.id === batch.id)) {
      removeBatch(batch.id);
      return;
    }
    if (batch.status === 'DISPATCH_APPROVED' && addBatch(batch)) {
      showMessage(`${batch.batch_number} added to the dispatch group.`, 'success');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await sync();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const raiseOrder = async (batch: Batch) => {
    if (!session) return;
    setRaisingId(batch.id);
    try {
      const operationId = newOperationId();
      await enqueueOperation({
        operation_id: operationId,
        type: 'DISPATCH_ORDER_RAISE',
        payload: {
          batch_id: batch.id,
          barcode_value: batch.barcode_value,
          expected_status: batch.status,
        },
        entity_type: 'dispatch_order',
        entity_id: batch.id,
      });
      await insertLocalDispatchOrder({
        id: nextLocalOrderId(),
        batch_id: batch.id,
        raised_by: session.user.id,
        status: 'PENDING',
        batch_number: batch.batch_number,
        barcode_value: batch.barcode_value,
        product_name: batch.product_name,
        product_sku: batch.product_sku,
        quantity: Number(batch.quantity || 0),
        uom: batch.uom,
        client_operation_id: operationId,
      });
      await setBatchLocalStatus(batch.id, 'DISPATCH_ORDER_RAISED', 1);
      showMessage(`${batch.batch_number} queued for admin approval.`, 'success');
      await load();
      await sync();
    } catch (err: any) {
      showMessage(err?.message || 'Could not queue the dispatch order.', 'error');
    } finally {
      setRaisingId(null);
    }
  };

  const submit = async () => {
    if (groupRef.current.length === 0) {
      showMessage('Scan at least one approved QR code before dispatching.', 'error');
      return;
    }
    const selected = groupRef.current;
    const batchIds = selected.map((batch) => batch.id);
    setSubmitting(true);
    try {
      await queueBulkOperation({
        operation_id: newOperationId(),
        type: 'DISPATCH_CONFIRM_BULK',
        payload: {
          barcodes: selected.map((batch) => batch.barcode_value),
          batch_ids: batchIds,
          remarks: remarks.trim() || null,
          images: photos,
        },
        batch_ids: batchIds,
        local_status: 'DISPATCHED',
        entity_type: 'dispatch_group',
      });
      showMessage(
        `Dispatch queued for ${selected.length} QR code${selected.length === 1 ? '' : 's'}. It will sync automatically.`,
        'success'
      );
      groupRef.current = [];
      setGroup([]);
      setRemarks('');
      setPhotos([]);
      setManual('');
      setScanning(false);
      await load();
      await sync();
    } catch (err: any) {
      showMessage(err?.message || 'Could not queue this group dispatch.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredApproved = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return approved.filter((batch) => {
      if (group.some((item) => item.id === batch.id)) return false;
      if (!needle) return true;
      return [batch.batch_number, batch.product_name, batch.product_sku, batch.barcode_value]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [approved, search, group]);

  const clearGroup = () => {
    if (groupRef.current.length === 0) return;
    groupRef.current = [];
    setGroup([]);
    showMessage('Dispatch group cleared. Remarks and photos are still available for the next group.', 'info');
  };

  const addVisibleApproved = () => {
    const visible = filteredApproved.slice(0, 20);
    let added = 0;
    for (const batch of visible) {
      if (addBatch(batch)) added += 1;
    }
    if (added > 0) {
      showMessage(
        `${added} approved batch${added === 1 ? '' : 'es'} added in one tap. ${groupRef.current.length} QR code${groupRef.current.length === 1 ? '' : 's'} ready.`,
        'success'
      );
    } else {
      showMessage('There are no more approved batches to add.', 'info');
    }
  };

  const visibleAddLabel = filteredApproved.length === 0
    ? 'Nothing to add'
    : filteredApproved.length > 20
      ? 'Add first 20'
      : `Add all shown (${filteredApproved.length})`;

  return (
    <Screen>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>DISPATCH GROUP SCAN</Text>
            <Text style={styles.title}>Dispatch a whole group</Text>
            <Text style={styles.subtitle}>
              Scan multiple approved QR labels, then confirm every code with one shared remark set.
            </Text>
          </View>
          <View style={styles.heroIcon}>
            <Ionicons name="car-outline" size={26} color={colors.success} />
          </View>
        </View>

        {message ? (
          <View
            style={[
              styles.message,
              messageKind === 'error'
                ? { backgroundColor: colors.dangerSoft }
                : messageKind === 'success'
                  ? { backgroundColor: colors.successSoft }
                  : { backgroundColor: colors.infoSoft },
            ]}
          >
            <Ionicons
              name={messageKind === 'error' ? 'alert-circle-outline' : messageKind === 'success' ? 'checkmark-circle-outline' : 'information-circle-outline'}
              size={16}
              color={messageKind === 'error' ? colors.danger : messageKind === 'success' ? colors.success : colors.info}
            />
            <Text
              style={[
                styles.messageText,
                { color: messageKind === 'error' ? colors.danger : messageKind === 'success' ? colors.success : colors.info },
              ]}
            >
              {message}
            </Text>
          </View>
        ) : null}

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Add approved QR codes"
            subtitle={`${online ? 'Online' : 'Offline'} · ${pendingCount} queued change${pendingCount === 1 ? '' : 's'}`}
            right={<Badge status="DISPATCH_APPROVED" label="Approved" />}
          />
          <View style={styles.scanButtons}>
            <Button
              title={scanning ? 'Stop camera' : 'Scan with camera'}
              variant={scanning ? 'secondary' : 'primary'}
              icon={<Ionicons name={scanning ? 'stop-circle-outline' : 'camera-outline'} size={18} color={scanning ? colors.text : '#fff'} />}
              onPress={() => {
                if (scanning) setScanning(false);
                else void startScanning();
              }}
              style={{ flex: 1 }}
            />
          </View>

          {scanning ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39'] }}
                onBarcodeScanned={onBarcodeScanned}
              />
              <View style={styles.cameraOverlay}>
                <Ionicons name="scan-outline" size={16} color="#fff" />
                <Text style={styles.cameraText}>Point at an approved QR label — keep scanning to build the group</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.manualRow}>
            <View style={{ flex: 1 }}>
              <Field
                value={manual}
                onChangeText={setManual}
                placeholder="Or type / paste a QR value"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => void addByBarcode(manual)}
              />
            </View>
            <Button
              title="Add"
              variant="secondary"
              onPress={() => void addByBarcode(manual)}
              style={{ alignSelf: 'flex-end' }}
            />
          </View>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Dispatch group"
            subtitle="Every code below must still be approved. One invalid code rejects the whole group."
            right={<Badge status="DISPATCH_APPROVED" label={`${group.length} codes`} />}
          />

          {group.length === 0 ? (
            <EmptyState
              title="No approved QR codes in this group"
              message="Scan an approved label or tap Add on an approved batch below."
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {group.map((batch) => (
                <View key={batch.id} style={styles.batchRow}>
                  <View style={styles.batchIcon}>
                    <Ionicons name="qr-code-outline" size={18} color={colors.success} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.batchTitle} numberOfLines={1}>{batch.product_name}</Text>
                    <Text style={styles.batchMeta} numberOfLines={1}>
                      {batch.batch_number} · {batch.product_sku} · {batch.quantity} {batch.uom || ''}
                    </Text>
                  </View>
                  <Pressable onPress={() => removeBatch(batch.id)} hitSlop={8} style={styles.removeButton}>
                    <Ionicons name="close-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Field
            label="Shared dispatch remarks"
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Destination, vehicle, or dispatch notes for the whole group"
            multiline
            numberOfLines={3}
            style={{ minHeight: 78, textAlignVertical: 'top' }}
          />
          <PhotoPicker uris={photos} onChange={setPhotos} />

          <Button
            title={
              submitting
                ? 'Queuing group...'
                : `Confirm dispatch for ${group.length} code${group.length === 1 ? '' : 's'}`
            }
            onPress={() => void submit()}
            loading={submitting}
            disabled={group.length === 0}
          />
          <Text style={styles.footerHint}>
            Saved on this device first. The server re-checks every approval before dispatching the
            group atomically.
          </Text>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Approved and ready"
            subtitle="Approved codes can be added to a group. QC-passed codes need an order first."
            right={<Badge status="QC_PASSED" label={`${ready.length} to raise`} />}
          />
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search approved batch, product, or SKU"
            autoCapitalize="none"
          />

          <View style={styles.quickRow}>
            <Button
              title={visibleAddLabel}
              small
              variant="secondary"
              disabled={filteredApproved.length === 0}
              onPress={addVisibleApproved}
              style={{ flex: 1 }}
            />
            <Button
              title="Clear group"
              small
              variant="ghost"
              disabled={group.length === 0}
              onPress={clearGroup}
            />
          </View>

          {filteredApproved.length === 0 ? (
            <EmptyState
              title={search ? 'No matching approved batches' : 'No approved batches'}
              message={search ? 'Try a different search.' : 'Approved orders appear here after sync.'}
            />
          ) : (
            filteredApproved.slice(0, 40).map((batch) => (
              <View key={batch.id} style={styles.pendingRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.pendingTitle} numberOfLines={1}>{batch.product_name}</Text>
                  <Text style={styles.pendingMeta} numberOfLines={1}>
                    {batch.batch_number} · {batch.product_sku}
                  </Text>
                  <Text style={styles.pendingAge}>approved {formatAge(batch.age_minutes)} ago</Text>
                </View>
                <Button title="Add" small variant="secondary" onPress={() => toggleBatch(batch)} />
              </View>
            ))
          )}

          {ready.length > 0 ? (
            <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
              <Text style={styles.sectionMini}>QC-PASSED — RAISE ORDER</Text>
              {ready.slice(0, 20).map((batch) => (
                <View key={batch.id} style={styles.pendingRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.pendingTitle} numberOfLines={1}>{batch.product_name}</Text>
                    <Text style={styles.pendingMeta} numberOfLines={1}>
                      {batch.batch_number} · {batch.quantity} {batch.uom || ''}
                    </Text>
                  </View>
                  <Button
                    title={raisingId === batch.id ? 'Queuing' : 'Raise order'}
                    small
                    loading={raisingId === batch.id}
                    onPress={() => void raiseOrder(batch)}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        <Text style={styles.userLine}>
          Signed in as {session?.user.name} · {syncing ? 'syncing' : online ? 'online' : 'offline'}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.success },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  messageText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  scanButtons: { flexDirection: 'row', gap: spacing.sm },
  cameraWrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#0f172a' },
  camera: { width: '100%', height: 260 },
  cameraOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.sm,
    backgroundColor: 'rgba(15,23,42,0.85)',
  },
  cameraText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  manualRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  batchIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  batchMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  removeButton: { padding: 4 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footerHint: { fontSize: 11, color: colors.textFaint, textAlign: 'center', lineHeight: 16 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pendingTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  pendingMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  pendingAge: { fontSize: 10, color: colors.textFaint, marginTop: 2 },
  sectionMini: { fontSize: 10, fontWeight: '800', color: colors.warning, letterSpacing: 1 },
  userLine: { fontSize: 10, color: colors.textFaint, textAlign: 'center' },
});
