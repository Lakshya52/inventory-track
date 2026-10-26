import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { cacheBatchForScannedQr, getBatchByBarcode } from '../db/database';
import { useSync } from '../sync/SyncContext';
import { Badge, Button, Card, Field, Screen, SectionHeader } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import type { Batch } from '../types';

type BatchLookup = Batch & {
  product_description?: string | null;
  product_physical_state?: string | null;
  product_storage_conditions?: string | null;
  hsn_code?: string | null;
  manufacturer?: string | null;
  scanned_qr?: string | null;
  matched_by_batch_number?: boolean;
};

function dateValue(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function priceValue(value?: number | null): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function QrLookupScreen() {
  const { online, sync } = useSync();
  const [permission, requestPermission] = useCameraPermissions();
  const isFocused = useIsFocused();
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [scannedValue, setScannedValue] = useState('');
  const [batch, setBatch] = useState<BatchLookup | null>(null);
  const [error, setError] = useState('');
  const [staleNotice, setStaleNotice] = useState('');
  const lookupInProgress = useRef(false);

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    void (async () => {
      try {
        const granted = permission?.granted ? true : (await requestPermission()).granted;
        if (!active) return;
        setCameraActive(granted);
        if (!granted) setError('Camera access is off. Allow it in device settings or enter the QR value below.');
      } catch {
        if (active) setError('Could not start the camera. Enter the QR value below to look it up.');
      }
    })();
    return () => { active = false; };
  }, [isFocused, permission?.granted, requestPermission]);

  const lookup = useCallback(async (rawValue: string) => {
    const value = rawValue.trim();
    if (!value || lookupInProgress.current) return;
    lookupInProgress.current = true;
    setCameraActive(false);
    setLoading(true);
    setError('');
    setStaleNotice('');
    setBatch(null);
    setScannedValue(value);
    setManualValue(value);
    try {
      const cached = await getBatchByBarcode(value);
      if (online) {
        try {
          const latest = await api.batchByBarcode(value) as BatchLookup;
          setBatch(latest);
          try {
            await cacheBatchForScannedQr(latest, value);
          } catch (cacheError) {
            console.warn('QR lookup succeeded, but its details could not be cached locally.', cacheError);
          }
          return;
        } catch (serverError: any) {
          if (!cached) throw serverError;
          setBatch(cached);
          setStaleNotice('Showing the saved details on this device. The server could not refresh this record.');
          return;
        }
      }
      if (!cached) {
        throw new Error('No matching product or batch is saved on this device. Connect to the server and scan again.');
      }
      setBatch(cached);
      setStaleNotice('Showing saved details. Connect to refresh the latest status.');
    } catch (lookupError: any) {
      setError(lookupError?.status === 404
        ? 'This QR code is not linked to a product or batch in the inventory.'
        : lookupError?.message || 'Could not look up this QR code. Try again.');
    } finally {
      lookupInProgress.current = false;
      setLoading(false);
    }
  }, [online]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      if (scannedValue) await lookup(scannedValue);
      else await sync();
    } finally {
      setRefreshing(false);
    }
  };

  const details = useMemo(() => {
    if (!batch) return [] as { label: string; value: string }[];
    const rows: [string, string | number | null | undefined][] = [
      ['Batch number', batch.batch_number],
      ['Product SKU', batch.product_sku],
      ['Quantity', `${batch.quantity ?? '-'} ${batch.uom || 'units'}`],
      ['Unit price', priceValue(batch.unit_price)],
      ['Manufactured', dateValue(batch.manufacturing_date)],
      ['Expires', dateValue(batch.expiry_date)],
      ['Shelf location', batch.location_code || batch.storage_location],
      ['Supplier', batch.vendor_name],
      ['Grade', batch.grade_name || batch.product_grade],
      ['Bag quantity', batch.bag_quantity == null ? null : `${batch.bag_quantity} ${batch.bag_quantity_unit || ''}`.trim()],
      ['QR labels', batch.qr_count == null ? null : String(batch.qr_count)],
      ['CAS number', batch.cas_number],
      ['Molecular formula', batch.molecular_formula],
      ['Purity', batch.product_purity],
      ['Physical state', batch.product_physical_state],
      ['Hazard classification', batch.hazard_classification],
      ['Storage conditions', batch.product_storage_conditions || batch.storage_conditions],
      ['Manufacturer', batch.manufacturer],
      ['HSN code', batch.hsn_code],
      ['Description', batch.product_description],
    ];
    return rows
      .filter(([, value]) => value != null && String(value).trim() !== '')
      .map(([label, value]) => ({ label, value: String(value) }));
  }, [batch]);

  const scanAnother = async () => {
    setBatch(null);
    setError('');
    setStaleNotice('');
    setScannedValue('');
    setManualValue('');
    if (permission?.granted) {
      setCameraActive(true);
      return;
    }
    try {
      const result = await requestPermission();
      if (result.granted) setCameraActive(true);
      else Alert.alert('Camera permission required', 'Allow camera access to scan product QR codes.');
    } catch {
      Alert.alert('Camera unavailable', 'Enter the QR value below or try again after checking camera permissions.');
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="scan-outline" size={25} color={colors.primary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>PRODUCT LOOKUP</Text>
            <Text style={styles.title}>Scan any product QR</Text>
            <Text style={styles.subtitle}>View its batch and current status, whatever stage it is in.</Text>
          </View>
        </View>

        {!batch ? (
          <Card style={styles.scanCard}>
            <SectionHeader title="Point at a QR label" subtitle="This lookup does not change QC or dispatch status." />
            {cameraActive ? (
              <View style={styles.cameraWrap}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }) => { void lookup(data); }}
                />
                <View style={styles.cameraOverlay}>
                  <Ionicons name="scan-outline" size={18} color="#fff" />
                  <Text style={styles.cameraHint}>Hold the QR code inside the camera view</Text>
                </View>
              </View>
            ) : (
              <View style={styles.cameraPlaceholder}>
                <Ionicons name="camera-outline" size={32} color={colors.textFaint} />
                <Text style={styles.placeholderText}>
                  {isFocused ? permission?.granted ? 'Camera paused after lookup.' : 'Camera permission is needed to scan.' : 'Camera paused while this page is closed.'}
                </Text>
                {isFocused ? <Button title={permission?.granted ? 'Resume scan' : 'Allow camera'} variant="secondary" onPress={() => void scanAnother()} /> : null}
              </View>
            )}
            <View style={styles.manualRow}>
              <Field
                label="Or enter a QR value / batch number"
                value={manualValue}
                onChangeText={setManualValue}
                placeholder="Paste or type the code"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => void lookup(manualValue)}
              />
              <Button title="Look up" loading={loading} disabled={!manualValue.trim()} onPress={() => void lookup(manualValue)} />
            </View>
          </Card>
        ) : (
          <>
            <Card style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <View style={styles.resultIcon}><Ionicons name="cube-outline" size={22} color={colors.primary} /></View>
                <View style={styles.resultTitleGroup}>
                  <Text style={styles.productName}>{batch.product_name || 'Product record'}</Text>
                  <Text style={styles.productSku}>{batch.product_sku || 'SKU not set'}</Text>
                </View>
                <Badge status={batch.status || 'UNKNOWN'} label={(batch.status || 'Unknown').replace(/_/g, ' ')} />
              </View>
              {batch.matched_by_batch_number ? (
                <View style={styles.infoNote}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.info} />
                  <Text style={styles.noteText}>Matched the unique batch number. Scan a unit label to identify that exact QR label.</Text>
                </View>
              ) : null}
              <View style={styles.detailList}>
                {details.map((row) => (
                  <View key={row.label} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{row.label}</Text>
                    <Text style={styles.detailValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.qrReference}>
                <Text style={styles.referenceLabel}>Scanned QR value</Text>
                <Text selectable style={styles.referenceValue}>{scannedValue}</Text>
              </View>
              {staleNotice ? (
                <View style={styles.infoNote}>
                  <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
                  <Text style={[styles.noteText, { color: colors.warning }]}>{staleNotice}</Text>
                </View>
              ) : null}
            </Card>
            <Button title="Scan another QR" large icon={<Ionicons name="scan-outline" size={20} color="#fff" />} onPress={() => void scanAnother()} />
          </>
        )}

        {loading ? <Text style={styles.loadingHint}>Looking up the product and batch…</Text> : null}
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            {batch ? null : <Pressable accessibilityRole="button" accessibilityLabel="Dismiss error" onPress={() => setError('')}><Ionicons name="close" size={18} color={colors.danger} /></Pressable>}
          </View>
        ) : null}
        {!online ? <Text style={styles.offlineHint}>Offline lookup uses QR codes already saved on this device.</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, color: colors.primary },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 3, lineHeight: 18 },
  scanCard: { gap: spacing.md },
  cameraWrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#0f172a' },
  camera: { width: '100%', height: 330 },
  cameraOverlay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.sm, backgroundColor: 'rgba(15,23,42,0.86)' },
  cameraHint: { color: '#fff', fontSize: 12, fontWeight: '600' },
  cameraPlaceholder: { minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.lg },
  placeholderText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  manualRow: { gap: spacing.sm },
  resultCard: { gap: spacing.md },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resultIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  resultTitleGroup: { flex: 1, minWidth: 0 },
  productName: { color: colors.text, fontSize: 17, fontWeight: '800' },
  productSku: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  detailList: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  detailLabel: { flex: 1, color: colors.textMuted, fontSize: 12 },
  detailValue: { flex: 1.2, color: colors.text, fontSize: 12, fontWeight: '600', textAlign: 'right' },
  qrReference: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  referenceLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  referenceValue: { color: colors.text, fontSize: 12, marginTop: 4 },
  infoNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.infoSoft },
  noteText: { flex: 1, color: colors.info, fontSize: 12, lineHeight: 17 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },
  loadingHint: { color: colors.textMuted, textAlign: 'center', fontSize: 12 },
  offlineHint: { color: colors.textFaint, fontSize: 12, textAlign: 'center' },
});
