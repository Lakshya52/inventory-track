import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { useSync } from '../sync/SyncContext';
import { newOperationId } from '../auth/authStorage';
import {
  getActiveClients,
  cacheBatchForScannedQr,
  getBatchByBarcode,
  getBatchesByStatus,
  queueDispatchOrderRequests,
  queueBulkOperation,
} from '../db/database';
import { Badge, Button, Card, EmptyState, Field, Screen, SectionHeader } from '../components/ui';
import { PhotoPicker } from '../components/PhotoPicker';
import { colors, radius, spacing } from '../theme';
import { formatAge } from '../utils/format';
import type { Batch, EntityId } from '../types';

type MessageKind = 'success' | 'error' | 'info';
type ScannedQr = { batch: Batch; qrValue: string };
type Client = { id: EntityId; name: string; contact_person: string | null };

function expectedQrCount(batch: Batch): number {
  if (Array.isArray(batch.unit_qr_codes) && batch.unit_qr_codes.length > 0) return batch.unit_qr_codes.length;
  if (typeof batch.unit_qr_codes === 'string') {
    try {
      const codes = JSON.parse(batch.unit_qr_codes);
      if (Array.isArray(codes) && codes.length > 0) return codes.length;
    } catch {
      // Fall back to the server's label count or batch quantity below.
    }
  }
  return Math.max(1, Math.floor(Number(batch.qr_count ?? batch.quantity) || 1));
}

function nextLocalOrderId(): string {
  return `local:${newOperationId()}`;
}

export default function DispatchScreen() {
  const { session } = useAuth();
  const { online, pendingCount, syncing, sync } = useSync();
  const { autostart } = useLocalSearchParams<{ autostart?: string }>();
  const router = useRouter();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [approved, setApproved] = useState<Batch[]>([]);
  const [ready, setReady] = useState<Batch[]>([]);
  const [group, setGroup] = useState<ScannedQr[]>([]);
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<MessageKind>('info');
  const [submitting, setSubmitting] = useState(false);
  const [raisingId, setRaisingId] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<EntityId | null>(null);
  const [driverName, setDriverName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [containerNumber, setContainerNumber] = useState('');
  const [selectedReadyIds, setSelectedReadyIds] = useState<EntityId[]>([]);
  const groupRef = useRef<ScannedQr[]>([]);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const autoStartHandledRef = useRef(false);

  const load = useCallback(async () => {
    const [approvedRows, readyRows, clientRows] = await Promise.all([
      getBatchesByStatus(['DISPATCH_APPROVED'], 200),
      getBatchesByStatus(['QC_PASSED', 'DISPATCH_REJECTED'], 200),
      getActiveClients(),
    ]);
    setApproved(approvedRows);
    setReady(readyRows);
    setClients(clientRows);
    setSelectedReadyIds((ids) => ids.filter((id) => readyRows.some((batch) => String(batch.id) === String(id))));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => setScanning(false);
    }, [load])
  );

  const showMessage = (text: string, kind: MessageKind) => {
    setMessage(text);
    setMessageKind(kind);
  };

  const addBatch = useCallback((batch: Batch, qrValue: string): boolean => {
    if (groupRef.current.some((item) => item.qrValue === qrValue)) return false;
    if (groupRef.current.length >= 1000) {
      showMessage('A dispatch group can contain at most 1,000 QR codes.', 'error');
      return false;
    }
    const next = [...groupRef.current, { batch, qrValue }];
    groupRef.current = next;
    setGroup(next);
    return true;
  }, []);

  const addByBarcode = useCallback(async (value: string) => {
    const barcode = value.trim();
    if (!barcode) return;
    let batch = await getBatchByBarcode(barcode);
    if (!batch && online) {
      try {
        batch = await api.batchByBarcode(barcode);
        try {
          await cacheBatchForScannedQr(batch, barcode);
        } catch (cacheError) {
          console.warn('Could not cache the scanned QR locally; continuing with the server result.', cacheError);
        }
      } catch (lookupError: any) {
        showMessage(lookupError?.status === 404
          ? 'This QR code is not registered on the server. Check the label or sync with your administrator.'
          : lookupError?.message || 'Could not look up this QR code. Check the connection and try again.', 'error');
        return;
      }
    }
    if (!batch) {
      showMessage('This QR code is not saved on this device. Connect and sync before scanning it.', 'error');
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
    if (!addBatch(batch, barcode)) {
      showMessage('That QR code is already in this dispatch group.', 'info');
      return;
    }
    setManual('');
    showMessage(
      `${batch.batch_number} added. ${groupRef.current.length} approved code${groupRef.current.length === 1 ? '' : 's'} ready.`,
      'success'
    );
  }, [addBatch, online]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.value === data && now - lastScanRef.current.at < 2000) {
      return;
    }
    lastScanRef.current = { value: data, at: now };
    void addByBarcode(data);
  }, [addByBarcode]);

  const startScanning = useCallback(async () => {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) {
        Alert.alert('Camera permission required', 'Allow camera access to scan approved QR labels.');
        return;
      }
    }
    setScanning(true);
  }, [permission?.granted, requestPermission]);

  useEffect(() => {
    if (autostart !== '1') {
      autoStartHandledRef.current = false;
      return;
    }
    if (autoStartHandledRef.current) return;
    autoStartHandledRef.current = true;
    router.setParams({ autostart: '' });
    void startScanning();
  }, [autostart, isFocused, router, startScanning]);

  const removeBatch = (qrValue: string) => {
    const next = groupRef.current.filter((item) => item.qrValue !== qrValue);
    groupRef.current = next;
    setGroup(next);
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

  const raiseOrders = async () => {
    if (!session) return;
    const selectedBatches = ready.filter((batch) => selectedReadyIds.some((id) => String(id) === String(batch.id)));
    const client = clients.find((item) => String(item.id) === String(selectedClientId));
    if (selectedBatches.length === 0 || !client || !driverName.trim() || !vehicleNumber.trim() || !containerNumber.trim()) {
      showMessage('Select at least one batch and a client, then enter the driver, vehicle, and container details.', 'error');
      return;
    }
    setRaisingId(true);
    try {
      await queueDispatchOrderRequests(selectedBatches.map((batch) => ({
        operation_id: newOperationId(),
        local_id: nextLocalOrderId(),
        batch,
        raised_by: session.user.id,
        client_id: client.id,
        client_name: client.name,
        driver_name: driverName.trim(),
        vehicle_number: vehicleNumber.trim(),
        container_number: containerNumber.trim(),
      })));
      showMessage(`${selectedBatches.length} dispatch request${selectedBatches.length === 1 ? '' : 's'} queued for ${client.name}.`, 'success');
      setSelectedReadyIds([]);
      setDriverName('');
      setVehicleNumber('');
      setContainerNumber('');
      await load();
      await sync();
    } catch (err: any) {
      showMessage(err?.message || 'Could not queue the dispatch order.', 'error');
    } finally {
      setRaisingId(false);
    }
  };

  const submit = async () => {
    if (groupRef.current.length === 0) {
      showMessage('Scan at least one approved QR code before dispatching.', 'error');
      return;
    }
    const selected = groupRef.current;
    const scannedCounts = new Map<string, number>();
    selected.forEach(({ batch }) => scannedCounts.set(String(batch.id), (scannedCounts.get(String(batch.id)) || 0) + 1));
    const incomplete = [...scannedCounts].find(([batchId, count]) => {
      const batch = selected.find((item) => String(item.batch.id) === batchId)?.batch;
      return !batch || count !== expectedQrCount(batch);
    });
    if (incomplete) {
      const batch = selected.find((item) => String(item.batch.id) === incomplete[0])?.batch;
      showMessage(
        `Scan every QR for ${batch?.batch_number || 'the batch'} (${incomplete[1]}/${batch ? expectedQrCount(batch) : '?'} scanned) before dispatching.`,
        'error'
      );
      return;
    }
    const batchIds = [...scannedCounts.keys()];
    setSubmitting(true);
    try {
      await queueBulkOperation({
        operation_id: newOperationId(),
        type: 'DISPATCH_CONFIRM_BULK',
        payload: {
          barcodes: selected.map((item) => item.qrValue),
          batch_ids: batchIds,
          remarks: remarks.trim() || null,
          images: photos,
        },
        batch_ids: batchIds,
        local_status: 'DISPATCHED',
        entity_type: 'dispatch_group',
      });
      showMessage(`Dispatch queued for ${selected.length} QR code${selected.length === 1 ? '' : 's'} across ${batchIds.length} batch${batchIds.length === 1 ? '' : 'es'}. It will sync automatically.`, 'success');
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
    if (group.some((item) => String(item.batch.id) === String(batch.id))) return false;
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

  return (
    <Screen>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical
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
            subtitle={`Tap once to scan approved labels · ${pendingCount} queued`}
            right={<Badge status="DISPATCH_APPROVED" label="Approved" />}
          />
          <View style={styles.scanButtons}>
            <Button
              title={scanning ? 'Stop scanning' : 'Start dispatch scan'}
              large
              variant={scanning ? 'secondary' : 'primary'}
              icon={<Ionicons name={scanning ? 'stop-circle-outline' : 'camera-outline'} size={22} color={scanning ? colors.text : '#fff'} />}
              onPress={() => {
                if (scanning) setScanning(false);
                else void startScanning();
              }}
              style={{ flex: 1 }}
            />
          </View>

          {scanning && isFocused ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onBarcodeScanned}
                onMountError={({ message }) => {
                  setScanning(false);
                  showMessage(`Camera could not start: ${message}`, 'error');
                }}
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
            subtitle="Scan every unit QR code for each approved batch before confirming."
            right={<Badge status="DISPATCH_APPROVED" label={`${group.length} codes`} />}
          />

          {group.length === 0 ? (
            <EmptyState
              title="No approved QR codes in this group"
              message="Scan every label on the batch, or enter each unique QR value manually."
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {group.map(({ batch, qrValue }) => (
                <View key={qrValue} style={styles.batchRow}>
                  <View style={styles.batchIcon}>
                    <Ionicons name="qr-code-outline" size={18} color={colors.success} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.batchTitle} numberOfLines={1}>{batch.product_name}</Text>
                    <Text style={styles.batchMeta} numberOfLines={1}>
                      {batch.batch_number} · {qrValue}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${qrValue} from dispatch group`} onPress={() => removeBatch(qrValue)} style={styles.removeButton}>
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
                <View style={{ minWidth: 0 }}>
                  <Text style={styles.pendingTitle} numberOfLines={1}>{batch.product_name}</Text>
                  <Text style={styles.pendingMeta} numberOfLines={1}>
                    {batch.batch_number} · {batch.product_sku}
                  </Text>
                  <Text style={styles.pendingAge}>approved {formatAge(batch.age_minutes)} ago</Text>
                </View>
                  <Text style={styles.pendingAge}>{expectedQrCount(batch)} QR label{expectedQrCount(batch) === 1 ? '' : 's'} required for dispatch</Text>
              </View>
            ))
          )}

          {ready.length > 0 ? (
            <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
              <Text style={styles.sectionMini}>QC-PASSED / REJECTED — SELECT BATCHES FOR ONE CLIENT REQUEST</Text>
              {clients.length === 0 ? (
                <Text style={styles.pendingAge}>Sync to load the active client list before raising requests.</Text>
              ) : (
                <View style={{ gap: spacing.xs }}>
                  <Text style={styles.pendingTitle}>Client</Text>
                  {clients.map((client) => {
              const active = String(selectedClientId) === String(client.id);
                    return (
                      <Pressable
                        key={client.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        onPress={() => setSelectedClientId(client.id)}
                        style={[styles.clientChoice, active && styles.clientChoiceSelected]}
                      >
                        <Text style={[styles.pendingTitle, active && { color: colors.success }]}>{client.name}</Text>
                        {client.contact_person ? <Text style={styles.pendingAge}>{client.contact_person}</Text> : null}
                      </Pressable>
                    );
                  })}
                  <Field
                    label="Driver name"
                    value={driverName}
                    onChangeText={setDriverName}
                    placeholder="Enter the assigned driver"
                  />
                  <Field
                    label="Vehicle number"
                    value={vehicleNumber}
                    onChangeText={setVehicleNumber}
                    placeholder="Enter the vehicle registration"
                    autoCapitalize="characters"
                  />
                  <Field
                    label="Container number"
                    value={containerNumber}
                    onChangeText={setContainerNumber}
                    placeholder="Enter the container number"
                    autoCapitalize="characters"
                  />
                </View>
              )}
              {ready.slice(0, 20).map((batch) => (
                <View key={batch.id} style={styles.pendingRow}>
                  <View style={{ minWidth: 0 }}>
                    <Text style={styles.pendingTitle} numberOfLines={1}>{batch.product_name}</Text>
                    <Text style={styles.pendingMeta} numberOfLines={1}>
                      {batch.batch_number} · {batch.quantity} {batch.uom || ''}
                    </Text>
                  </View>
                  <Button
                title={selectedReadyIds.some((id) => String(id) === String(batch.id)) ? 'Selected' : 'Select'}
                    small
                variant={selectedReadyIds.some((id) => String(id) === String(batch.id)) ? 'primary' : 'secondary'}
                    onPress={() => setSelectedReadyIds((ids) =>
                    ids.some((id) => String(id) === String(batch.id)) ? ids.filter((id) => String(id) !== String(batch.id)) : [...ids, batch.id]
                    )}
                  />
                </View>
              ))}
              <Button
              title={raisingId ? 'Queuing requests...' : `Raise request for ${selectedReadyIds.length} batch${selectedReadyIds.length === 1 ? '' : 'es'}`}
              loading={raisingId}
                disabled={selectedReadyIds.length === 0 || !selectedClientId || !driverName.trim() || !vehicleNumber.trim() || !containerNumber.trim()}
                onPress={() => void raiseOrders()}
              />
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
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 },
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
  messageText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  scanButtons: { flexDirection: 'row', gap: spacing.sm },
  cameraWrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#0f172a' },
  camera: { width: '100%', height: 320 },
  cameraOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.sm,
    backgroundColor: 'rgba(15,23,42,0.85)',
  },
  cameraText: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
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
  batchTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  batchMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footerHint: { fontSize: 12, color: colors.textFaint, textAlign: 'center', lineHeight: 18 },
  pendingRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pendingTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  pendingMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  pendingAge: { fontSize: 12, color: colors.textFaint, marginTop: 3 },
  sectionMini: { fontSize: 12, fontWeight: '800', color: colors.warning, letterSpacing: 0.5 },
  clientChoice: {
    minHeight: 48,
    justifyContent: 'center',
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  clientChoiceSelected: { borderColor: colors.success, backgroundColor: colors.successSoft },
  userLine: { fontSize: 10, color: colors.textFaint, textAlign: 'center' },
});
