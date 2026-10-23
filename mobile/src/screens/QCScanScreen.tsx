import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { newOperationId } from '../auth/authStorage';
import { getBatchByBarcode, getBatchesByStatus, queueBulkOperation } from '../db/database';
import { Badge, Button, Card, EmptyState, Field, Screen, SectionHeader } from '../components/ui';
import { PhotoPicker } from '../components/PhotoPicker';
import { colors, radius, spacing } from '../theme';
import { formatAge } from '../utils/format';
import type { Batch } from '../types';

type Result = 'PASS' | 'FAIL';
type MessageKind = 'success' | 'error' | 'info';
type ScannedQr = { batch: Batch; qrValue: string };

function expectedQrCount(batch: Batch): number {
  if (Array.isArray(batch.unit_qr_codes)) return batch.unit_qr_codes.length;
  if (typeof batch.unit_qr_codes === 'string') {
    try {
      const codes = JSON.parse(batch.unit_qr_codes);
      if (Array.isArray(codes)) return codes.length;
    } catch {
      return Math.max(1, Math.floor(Number(batch.quantity) || 1));
    }
  }
  return Math.max(1, Math.floor(Number(batch.qr_count ?? batch.quantity) || 1));
}

export default function QCScanScreen() {
  const { session } = useAuth();
  const { online, pendingCount, syncing, sync } = useSync();
  const [permission, requestPermission] = useCameraPermissions();
  const [pending, setPending] = useState<Batch[]>([]);
  const [group, setGroup] = useState<ScannedQr[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<MessageKind>('info');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const groupRef = useRef<ScannedQr[]>([]);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  const loadPending = useCallback(async () => {
    const rows = await getBatchesByStatus(['CREATED'], 200);
    setPending(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPending();
    }, [loadPending])
  );

  const showMessage = (text: string, kind: MessageKind) => {
    setMessage(text);
    setMessageKind(kind);
  };

  const addBatch = useCallback((batch: Batch, qrValue: string): boolean => {
    if (groupRef.current.some((item) => item.qrValue === qrValue)) return false;
    if (groupRef.current.length >= 1000) {
      showMessage('A QC group can contain at most 1,000 QR codes.', 'error');
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
    const batch = await getBatchByBarcode(barcode);
    if (!batch) {
      showMessage('That QR code is not on this device yet. Sync while online, then try again.', 'error');
      return;
    }
    if (batch.status !== 'CREATED') {
      showMessage(
        `${batch.batch_number} is ${batch.status.replace(/_/g, ' ').toLowerCase()} and cannot be tested again.`,
        'error'
      );
      return;
    }
    if (!addBatch(batch, barcode)) {
      showMessage('That QR code is already in this group.', 'info');
      return;
    }
    setManual('');
    showMessage(
      `${batch.batch_number} added. ${groupRef.current.length} QR code${groupRef.current.length === 1 ? '' : 's'} ready.`,
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
        Alert.alert('Camera permission required', 'Allow camera access to scan QR labels.');
        return;
      }
    }
    groupRef.current = group;
    setScanning(true);
  };

  const removeBatch = (qrValue: string) => {
    const next = groupRef.current.filter((item) => item.qrValue !== qrValue);
    groupRef.current = next;
    setGroup(next);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await sync();
      await loadPending();
    } finally {
      setRefreshing(false);
    }
  };

  const submit = async () => {
    if (!result || groupRef.current.length === 0) {
      showMessage('Add at least one QR code and choose PASS or FAIL.', 'error');
      return;
    }
    const selected = groupRef.current;
    const batchIds = [...new Set(selected.map((item) => item.batch.id))];
    const scannedCounts = new Map<number, number>();
    selected.forEach(({ batch }) => scannedCounts.set(batch.id, (scannedCounts.get(batch.id) || 0) + 1));
    const incomplete = [...scannedCounts].find(([batchId, count]) => {
      const batch = selected.find((item) => item.batch.id === batchId)?.batch;
      return !batch || count !== expectedQrCount(batch);
    });
    if (incomplete) {
      const batch = selected.find((item) => item.batch.id === incomplete[0])?.batch;
      showMessage(
        `Scan every QR for ${batch?.batch_number || 'the batch'} (${incomplete[1]}/${batch ? expectedQrCount(batch) : '?'} scanned) before submitting QC.`,
        'error'
      );
      return;
    }
    setSubmitting(true);
    try {
      await queueBulkOperation({
        operation_id: newOperationId(),
        type: 'QC_SUBMIT_BULK',
        payload: {
          barcodes: selected.map((item) => item.qrValue),
          batch_ids: batchIds,
          result,
          remarks: remarks.trim() || null,
          images: photos,
        },
        batch_ids: batchIds,
        local_status: result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED',
        entity_type: 'qc_group',
      });
      showMessage(
        `QC ${result} queued for ${selected.length} QR code${selected.length === 1 ? '' : 's'} across ${batchIds.length} batch${batchIds.length === 1 ? '' : 'es'}. It will sync automatically.`,
        'success'
      );
      groupRef.current = [];
      setGroup([]);
      setResult(null);
      setRemarks('');
      setPhotos([]);
      setManual('');
      setScanning(false);
      await loadPending();
      await sync();
    } catch (err: any) {
      showMessage(err?.message || 'Could not queue this QC submission.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredPending = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return pending.filter((batch) => {
      if (group.some((item) => item.batch.id === batch.id)) return false;
      if (!needle) return true;
      return [batch.batch_number, batch.product_name, batch.product_sku, batch.barcode_value]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [pending, search, group]);

  const clearGroup = () => {
    if (groupRef.current.length === 0) return;
    groupRef.current = [];
    setGroup([]);
    showMessage('QC group cleared. The result and remarks are still available for the next group.', 'info');
  };

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
            <Text style={styles.eyebrow}>QC GROUP SCAN</Text>
            <Text style={styles.title}>Test a whole group</Text>
            <Text style={styles.subtitle}>
              Scan multiple QR labels, then apply one PASS/FAIL result to every code.
            </Text>
          </View>
          <View style={styles.heroIcon}>
            <Ionicons name="flask-outline" size={26} color={colors.info} />
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
            title="Add QR codes"
            subtitle={`${online ? 'Online' : 'Offline'} · ${pendingCount} queued change${pendingCount === 1 ? '' : 's'}`}
            right={<Badge status="CREATED" label="QC pending" />}
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
                <Text style={styles.cameraText}>Point at a QR label — keep scanning to build the group</Text>
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
            title="QC group"
            subtitle="Scan every unit QR in each batch before applying one result."
            right={<Badge status="APPLIED" label={`${group.length} codes`} />}
          />

          {group.length === 0 ? (
            <EmptyState
              title="No QR codes in this group"
              message="Scan a label or tap Add on a pending batch below. All codes must still be waiting for QC."
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {group.map(({ batch, qrValue }) => (
                <View key={qrValue} style={styles.batchRow}>
                  <View style={styles.batchIcon}>
                    <Ionicons name="qr-code-outline" size={18} color={colors.info} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.batchTitle} numberOfLines={1}>{batch.product_name}</Text>
                    <Text style={styles.batchMeta} numberOfLines={1}>
                      {batch.batch_number} · {qrValue}
                    </Text>
                  </View>
                  <Pressable onPress={() => removeBatch(qrValue)} hitSlop={8} style={styles.removeButton}>
                    <Ionicons name="close-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={styles.resultRow}>
            <Pressable
              onPress={() => setResult('PASS')}
              style={[
                styles.resultButton,
                result === 'PASS' && { borderColor: colors.success, backgroundColor: colors.successSoft },
              ]}
            >
              <Ionicons name="checkmark-circle-outline" size={22} color={result === 'PASS' ? colors.success : colors.textFaint} />
              <Text style={[styles.resultText, result === 'PASS' && { color: colors.success }]}>PASS ALL</Text>
            </Pressable>
            <Pressable
              onPress={() => setResult('FAIL')}
              style={[
                styles.resultButton,
                result === 'FAIL' && { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
              ]}
            >
              <Ionicons name="close-circle-outline" size={22} color={result === 'FAIL' ? colors.danger : colors.textFaint} />
              <Text style={[styles.resultText, result === 'FAIL' && { color: colors.danger }]}>FAIL ALL</Text>
            </Pressable>
          </View>

          <Field
            label="Shared remarks"
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Applied to every QR code in this group"
            multiline
            numberOfLines={3}
            style={{ minHeight: 78, textAlignVertical: 'top' }}
          />

          <PhotoPicker uris={photos} onChange={setPhotos} />

          <Button
            title={
              submitting
                ? 'Queuing group...'
                : `Queue QC ${result || 'result'} for ${group.length} code${group.length === 1 ? '' : 's'}`
            }
            onPress={() => void submit()}
            loading={submitting}
            disabled={!result || group.length === 0}
          />
          <Text style={styles.footerHint}>
            Saved on this device first. The server applies the group atomically when it syncs.
          </Text>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Pending QC"
            subtitle={`${pending.length} batch${pending.length === 1 ? '' : 'es'} waiting on this device · scan each product QR`}
            right={<Badge status="CREATED" label="Created" />}
          />
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search batch, product, or SKU"
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
          {filteredPending.length === 0 ? (
            <EmptyState
              title={search ? 'No matching pending batches' : 'No pending batches'}
              message={search ? 'Try a different search.' : 'Sync to pull the latest QC queue onto this device.'}
            />
          ) : (
            filteredPending.slice(0, 40).map((batch) => (
              <View key={batch.id} style={styles.pendingRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.pendingTitle} numberOfLines={1}>{batch.product_name}</Text>
                  <Text style={styles.pendingMeta} numberOfLines={1}>
                    {batch.batch_number} · {batch.product_sku}
                  </Text>
                  <Text style={styles.pendingAge}>waiting {formatAge(batch.age_minutes)}</Text>
                </View>
                <Text style={styles.pendingAge}>Scan its {expectedQrCount(batch)} QR label{expectedQrCount(batch) === 1 ? '' : 's'} to add this batch.</Text>
              </View>
            ))
          )}
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
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.info },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.infoSoft,
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
  cameraWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
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
  resultRow: { flexDirection: 'row', gap: spacing.sm },
  resultButton: {
    flex: 1,
    minHeight: 62,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  resultText: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4 },
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
  userLine: { fontSize: 10, color: colors.textFaint, textAlign: 'center' },
});
