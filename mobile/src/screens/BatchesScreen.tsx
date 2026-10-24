import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import QRCode from 'qrcode';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { searchBatches } from '../db/database';
import { useSync } from '../sync/SyncContext';
import { Badge, Button, Card, EmptyState, Field, Screen, SectionHeader } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import { formatAge, formatDate } from '../utils/format';
import type {
  Batch,
  CreateBatchesResponse,
  MobileMasterOption,
  MobileProduct,
  MobileShelfLocation,
  MobileVendor,
  QrLabel,
  QrPrintJob,
} from '../types';

type BatchFilter = 'ALL' | 'CREATED' | 'QC_PASSED' | 'QC_FAILED' | 'DISPATCHED';
type BatchDateField = 'manufacturing' | 'expiry';
type PickerOption = { value: string; label: string; detail?: string };
type PickerState = {
  title: string;
  options: PickerOption[];
  value: string;
  onSelect: (value: string) => void;
} | null;

const filters: { value: BatchFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'CREATED', label: 'Waiting QC' },
  { value: 'QC_PASSED', label: 'Passed' },
  { value: 'QC_FAILED', label: 'Failed' },
  { value: 'DISPATCHED', label: 'Dispatched' },
];

function isActive(row: { is_active?: boolean | number }): boolean {
  return row.is_active == null || row.is_active === true || Number(row.is_active) === 1;
}

function dateFromDateOnly(value: string): Date | null {
  if (!isValidDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateOnlyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeBatchNumber(sku: string, batches: Batch[]): string {
  const prefix = `${sku}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const last = batches.reduce((max, batch) => {
    const suffix = batch.batch_number.startsWith(`${prefix}-`)
      ? batch.batch_number.slice(prefix.length + 1)
      : '';
    return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);
  return `${prefix}-${String(last + 1).padStart(3, '0')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

async function labelSetsHtml(sets: { job: QrPrintJob; labels: QrLabel[] }[]): Promise<string> {
  const entries: { job: QrPrintJob; label: QrLabel; total: number }[] = [];
  for (const { job, labels } of sets) {
    if (!Array.isArray(labels)) {
      throw new Error('The server did not return QR labels for this batch. Update the app server and try again.');
    }
    for (const label of labels) entries.push({ job, label, total: labels.length });
  }
  if (entries.length === 0) throw new Error('No QR labels were returned for printing.');
  const cards = await Promise.all(entries.map(async ({ job, label, total }) => {
    const qrSvg = await QRCode.toString(label.qr_value, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    });
    return `
      <article class="label">
        <div class="brand">ACEONE INVENTORY</div>
        <div class="qr">${qrSvg}</div>
        <div class="product">${escapeHtml(job.product_name)}</div>
        <div class="batch">${escapeHtml(label.batch_number || '')}</div>
        <div class="serial">Unit ${label.serial_no} of ${total}</div>
        <div class="code">${escapeHtml(label.qr_value)}</div>
      </article>`;
  }));
  return `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          @page { margin: 8mm; }
          body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; }
          .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; }
          .label { min-height: 62mm; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 4mm; display: flex; flex-direction: column; align-items: center; text-align: center; page-break-inside: avoid; }
          .brand { font-size: 8px; font-weight: 700; letter-spacing: 1px; color: #4f46e5; }
          .qr { width: 34mm; height: 34mm; margin: 2mm 0; }
          .qr svg { width: 100%; height: 100%; }
          .product { font-size: 10px; font-weight: 700; }
          .batch { font-size: 9px; margin-top: 1mm; }
          .serial, .code { color: #475569; font-size: 7px; margin-top: 1mm; }
          .code { overflow-wrap: anywhere; }
        </style>
      </head>
      <body><main class="sheet">${cards.join('')}</main></body>
    </html>`;
}

async function createdBatchLabelSets(
  response: CreateBatchesResponse
): Promise<{ job: QrPrintJob; labels: QrLabel[] }[]> {
  if (!Array.isArray(response?.batches) || response.batches.length === 0) {
    throw new Error('The server created the batch but did not return its batch details. Update the backend and try again.');
  }

  const needsLookup = response.batches.some(
    (batch) => !batch.qr_job || !Array.isArray(batch.labels)
  );
  const batches = needsLookup ? await api.listBatches() : [];
  return Promise.all(response.batches.map(async (batch) => {
    if (batch.qr_job && Array.isArray(batch.labels)) {
      return { job: batch.qr_job, labels: batch.labels };
    }
    const stored = batches.find((item) => Number(item.id) === Number(batch.id));
    if (!stored?.qr_job_id) {
      throw new Error(
        `Batch ${batch.batch_number} was created, but the server has not generated its unit QR labels yet. Deploy the latest backend, then retry.`
      );
    }
    const detail = await api.getQrJob(Number(stored.qr_job_id));
    if (!detail.job || !Array.isArray(detail.labels) || detail.labels.length === 0) {
      throw new Error(`The server returned no QR labels for batch ${batch.batch_number}.`);
    }
    return { job: detail.job, labels: detail.labels };
  }));
}

async function downloadLabelSets(sets: { job: QrPrintJob; labels: QrLabel[] }[]): Promise<void> {
  const html = await labelSetsHtml(sets);
  const file = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Save QR labels PDF',
    UTI: 'com.adobe.pdf',
  });
}

function SelectField({
  label,
  value,
  placeholder,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable onPress={onPress} style={styles.selectField}>
        <Text style={[styles.selectText, !value && { color: colors.textFaint }]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={17} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

function OptionPicker({
  picker,
  onClose,
}: {
  picker: PickerState;
  onClose: () => void;
}) {
  if (!picker) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalShade}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.pickerSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{picker.title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {picker.options.map((option) => {
              const selected = picker.value === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    picker.onSelect(option.value);
                    onClose();
                  }}
                  style={styles.optionRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    {option.detail ? <Text style={styles.optionDetail}>{option.detail}</Text> : null}
                  </View>
                  {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
            {picker.options.length === 0 ? (
              <EmptyState title="No active options" message="Refresh while online and try again." />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function BatchesScreen() {
  const { session } = useAuth();
  const { online, sync } = useSync();
  const isQc = session?.user.role === 'QC';
  const canManageQr = isQc || session?.user.role === 'ADMIN';

  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<MobileProduct[]>([]);
  const [vendors, setVendors] = useState<MobileVendor[]>([]);
  const [grades, setGrades] = useState<MobileMasterOption[]>([]);
  const [bagQuantities, setBagQuantities] = useState<MobileMasterOption[]>([]);
  const [locations, setLocations] = useState<MobileShelfLocation[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BatchFilter>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [picker, setPicker] = useState<PickerState>(null);

  const [createVisible, setCreateVisible] = useState(false);
  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [batchCount, setBatchCount] = useState('1');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [datePicker, setDatePicker] = useState<BatchDateField | null>(null);
  const [dateDraft, setDateDraft] = useState(new Date());
  const [notes, setNotes] = useState('');
  const [createLocationId, setCreateLocationId] = useState('');

  const [finishBatch, setFinishBatch] = useState<Batch | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [bagQuantityId, setBagQuantityId] = useState('');
  const [finishLocationId, setFinishLocationId] = useState('');
  const [reopenBatch, setReopenBatch] = useState<Batch | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [printJob, setPrintJob] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError('');
    if (online) {
      try {
        const [batchRows, productRows, vendorRows, gradeRows, bagRows, locationRows] = await Promise.all([
          api.listBatches(),
          isQc ? api.listProducts() : Promise.resolve([]),
          isQc ? api.listVendors() : Promise.resolve([]),
          isQc ? api.listMasterOptions('grades') : Promise.resolve([]),
          isQc ? api.listMasterOptions('bag-quantities') : Promise.resolve([]),
          api.listShelfLocations(),
        ]);
        setBatches(batchRows);
        setProducts(productRows);
        setVendors(vendorRows.filter(isActive));
        setGrades(gradeRows.filter(isActive));
        setBagQuantities(bagRows.filter(isActive));
        setLocations(locationRows.filter(isActive));
        return;
      } catch (err: any) {
        setError(`${err?.message || 'Could not refresh batches.'} Showing batches saved on this device.`);
      }
    }
    try {
      setBatches(await searchBatches('', undefined, 500));
    } catch (err: any) {
      setError(err?.message || 'Could not load batches from this device.');
    }
  }, [isQc, online]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    setNotice('');
    try {
      await sync();
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not refresh batches.');
    } finally {
      setRefreshing(false);
    }
  };

  const filteredBatches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return batches.filter((batch) => {
      const matchesSearch = !needle || [
        batch.product_name,
        batch.product_sku,
        batch.batch_number,
        batch.barcode_value,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
      const matchesFilter = filter === 'ALL'
        || (filter === 'DISPATCHED'
          ? batch.status === 'DISPATCHED'
          : batch.status === filter);
      return matchesSearch && matchesFilter;
    });
  }, [batches, filter, search]);

  const stats = useMemo(() => ({
    total: batches.length,
    waiting: batches.filter((batch) => batch.status === 'CREATED').length,
    passed: batches.filter((batch) => batch.status === 'QC_PASSED').length,
    failed: batches.filter((batch) => batch.status === 'QC_FAILED').length,
  }), [batches]);

  const selectedProduct = products.find((product) => String(product.id) === productId);
  const createProductLabel = selectedProduct
    ? `${selectedProduct.name} (${selectedProduct.sku})`
    : '';

  const resetCreateForm = () => {
    setProductId('');
    setBatchNumber('');
    setBatchCount('1');
    setQuantity('1');
    setUnitPrice('');
    setManufacturingDate('');
    setExpiryDate('');
    setNotes('');
    setCreateLocationId('');
  };

  const createBatches = async () => {
    if (!online) {
      setError('Creating batches requires a connection. Your existing batch list remains available offline.');
      return;
    }
    const count = Number(batchCount);
    const units = Number(quantity);
    const price = Number(unitPrice || 0);
    if (!selectedProduct) {
      setError('Choose a product before creating the batch.');
      return;
    }
    if (!batchNumber.trim()) {
      setError('Enter a batch number.');
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setError('Number of batches must be a whole number from 1 to 100.');
      return;
    }
    if (!Number.isInteger(units) || units < 1 || units > 1000 || units * count > 10000) {
      setError('Products per batch must be 1–1,000 and one generation cannot exceed 10,000 products.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Enter a valid non-negative unit price.');
      return;
    }
    if (!isValidDate(manufacturingDate) || !isValidDate(expiryDate)) {
      setError('Enter valid manufacturing and expiry dates in YYYY-MM-DD format.');
      return;
    }

    setLoadingAction(true);
    setError('');
    setNotice('');
    let qrDownloadError = '';
    try {
      const created = await api.createBatches({
        product_id: selectedProduct.id,
        batch_number: batchNumber.trim(),
        quantity: units,
        batch_count: count,
        unit_price: price,
        manufacturing_date: manufacturingDate,
        expiry_date: expiryDate,
        notes: notes.trim() || undefined,
        shelf_location_id: createLocationId ? Number(createLocationId) : undefined,
      });
      setCreateVisible(false);
      resetCreateForm();
      setNotice(`${created.message} Choose where to save or share the QR PDF.`);
      try {
        const labelSets = await createdBatchLabelSets(created);
        await downloadLabelSets(labelSets);
        setNotice(`${created.batches.length} batch${created.batches.length === 1 ? '' : 'es'} created. QR PDF opened for saving or sharing.`);
      } catch (err: any) {
        qrDownloadError = `Batches were created, but the QR PDF could not be opened: ${err?.message || 'File sharing is unavailable.'}`;
      }
      try {
        await sync();
        await load();
      } catch (err: any) {
        setError(`Batches and QR labels were created, but refresh failed: ${err?.message || 'Could not sync batches.'}`);
      }
      if (qrDownloadError) setError(qrDownloadError);
    } catch (err: any) {
      setError(err?.message || 'Could not create QC batches.');
    } finally {
      setLoadingAction(false);
    }
  };

  const finishGoods = async () => {
    if (!finishBatch) return;
    if (!online) {
      setError('Finished-goods details and QR label generation require a connection.');
      return;
    }
    if (!vendorId || !gradeId || !bagQuantityId) {
      setError('Select a supplier, grade, and bag quantity.');
      return;
    }
    setLoadingAction(true);
    setError('');
    setNotice('');
    try {
      const result = await api.finishGoods(finishBatch.id, {
        vendor_id: Number(vendorId),
        grade_id: Number(gradeId),
        bag_quantity_id: Number(bagQuantityId),
        shelf_location_id: finishLocationId ? Number(finishLocationId) : undefined,
      });
      setFinishBatch(null);
      setNotice(`Finished-goods details saved. The batch's ${result.labels.length} QR labels are unchanged.`);
      await load();
      await sync();
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not save finished-goods details.');
    } finally {
      setLoadingAction(false);
    }
  };

  const reprintLabels = async (batch: Batch) => {
    if (!online) {
      setError('Reprinting QR labels requires a connection.');
      return;
    }
    if (!batch.qr_job_id) {
      setError('This batch does not have a QR print job yet.');
      return;
    }
    setPrintJob(batch.id);
    setError('');
    setNotice('');
    try {
      const detail = await api.getQrJob(batch.qr_job_id);
      const reprinted = await api.reprintQrLabels(
        batch.qr_job_id,
        detail.labels.map((label) => label.id)
      );
      await downloadLabelSets([{ job: reprinted.job, labels: reprinted.labels }]);
      setNotice(`${reprinted.labels.length} QR labels opened as a PDF for saving or sharing.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not reprint this batch’s QR labels.');
    } finally {
      setPrintJob(null);
    }
  };

  const reprintGroupLabels = async (group: Batch[]) => {
    if (!online) {
      setError('Reprinting a batch group requires a connection.');
      return;
    }
    const readyGroup = group.filter((batch) => batch.qr_job_id);
    if (readyGroup.length !== group.length) {
      setError(`QR labels are missing for ${group.length - readyGroup.length} batch${group.length - readyGroup.length === 1 ? '' : 'es'}. Finish-goods details for passed legacy batches to generate their labels.`);
      return;
    }
    setPrintJob(group[0].id);
    setError('');
    setNotice('');
    try {
      const labelSets = await Promise.all(readyGroup.map(async (batch) => {
        const detail = await api.getQrJob(Number(batch.qr_job_id));
        return api.reprintQrLabels(
          Number(batch.qr_job_id),
          detail.labels.map((label) => label.id)
        );
      }));
      await downloadLabelSets(labelSets.map((detail) => ({
        job: detail.job,
        labels: detail.labels,
      })));
      const labelCount = labelSets.reduce((total, detail) => total + detail.labels.length, 0);
      setNotice(`${labelCount} QR labels across ${labelSets.length} batches opened as a PDF for saving or sharing.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not print this batch group.');
    } finally {
      setPrintJob(null);
    }
  };

  const reopenForQc = async () => {
    if (!reopenBatch) return;
    if (!online) {
      setError('Sending a failed batch for re-QC requires a connection.');
      return;
    }
    if (!reopenReason.trim()) {
      setError('A reason is required to send a failed batch back for QC.');
      return;
    }
    setLoadingAction(true);
    setError('');
    setNotice('');
    try {
      await api.reopenFailedBatch(reopenBatch.id, reopenReason.trim());
      setNotice(`${reopenBatch.batch_number} sent back for QC.`);
      setReopenBatch(null);
      setReopenReason('');
      await sync();
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not reopen this batch for QC.');
    } finally {
      setLoadingAction(false);
    }
  };

  const openFinishGoods = (batch: Batch) => {
    setFinishBatch(batch);
    setVendorId('');
    setGradeId('');
    setBagQuantityId('');
    setFinishLocationId(batch.shelf_location_id ? String(batch.shelf_location_id) : '');
    setError('');
  };

  const showProductPicker = () => {
    setPicker({
      title: 'Choose product',
      value: productId,
      options: products.map((product) => ({
        value: String(product.id),
        label: `${product.name} (${product.sku})`,
        detail: product.cas_number ? `CAS ${product.cas_number}` : undefined,
      })),
      onSelect: (value) => {
        const product = products.find((row) => String(row.id) === value);
        setProductId(value);
        if (product) {
          setBatchNumber(makeBatchNumber(product.sku, batches));
          setUnitPrice(product.price && product.price > 0 ? String(product.price) : '');
        }
        setError('');
      },
    });
  };

  const openPicker = (
    title: string,
    options: PickerOption[],
    value: string,
    onSelect: (value: string) => void
  ) => setPicker({ title, options, value, onSelect });

  const openDatePicker = (field: BatchDateField) => {
    const currentValue = field === 'manufacturing' ? manufacturingDate : expiryDate;
    setDateDraft(dateFromDateOnly(currentValue) || new Date());
    setDatePicker(field);
  };

  const savePickedDate = (field: BatchDateField, date: Date) => {
    const value = dateOnlyFromDate(date);
    if (field === 'manufacturing') setManufacturingDate(value);
    else setExpiryDate(value);
  };

  const handleDateValueChange = (selectedDate: Date) => {
    if (Platform.OS === 'android') {
      const field = datePicker;
      setDatePicker(null);
      if (field) savePickedDate(field, selectedDate);
      return;
    }
    setDateDraft(selectedDate);
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
            <Text style={styles.eyebrow}>{isQc ? 'QC BATCH MANAGEMENT' : 'INVENTORY'}</Text>
            <Text style={styles.title}>Batches</Text>
            <Text style={styles.subtitle}>
              {isQc
                ? 'Create QC batches with instant QR downloads, complete passed batches, and manage labels.'
                : 'Browse batches synced to this device.'}
            </Text>
          </View>
          {isQc ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setError('');
                if (!online) {
                  setError('Connect to the server to create a QC batch.');
                  return;
                }
                setCreateVisible(true);
              }}
              style={styles.createButton}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.createButtonText}>New batch</Text>
            </Pressable>
          ) : (
            <View style={styles.heroIcon}>
              <Ionicons name="albums-outline" size={25} color={colors.primary} />
            </View>
          )}
        </View>

        <View style={styles.statusBanner}>
          <Ionicons
            name={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
            size={17}
            color={online ? colors.success : colors.warning}
          />
          <Text style={styles.statusBannerText}>
            {online ? 'Connected · batch actions available' : 'Offline · showing saved batches; management actions need connection'}
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setError('')} hitSlop={8}>
              <Ionicons name="close-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>
        ) : null}
        {notice ? (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle-outline" size={17} color={colors.success} />
            <Text style={styles.successText}>{notice}</Text>
            <Pressable onPress={() => setNotice('')} hitSlop={8}>
              <Ionicons name="close-outline" size={18} color={colors.success} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <Metric label="All batches" value={stats.total} tint={colors.primary} />
          <Metric label="Waiting QC" value={stats.waiting} tint={colors.warning} />
          <Metric label="QC passed" value={stats.passed} tint={colors.success} />
          <Metric label="QC failed" value={stats.failed} tint={colors.danger} />
        </View>

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Batch inventory"
            subtitle={`${filteredBatches.length} shown · ${batches.length} total`}
            right={<Badge status={online ? 'APPLIED' : 'PENDING'} label={online ? 'Live' : 'On device'} />}
          />
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search product, SKU, batch, or barcode"
            autoCapitalize="none"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {filters.map((item) => {
              const selected = filter === item.value;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(item.value)}
                  style={[styles.filterChip, selected && styles.filterChipSelected]}
                >
                  <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {filteredBatches.length === 0 ? (
            <EmptyState
              title={search || filter !== 'ALL' ? 'No matching batches' : 'No batches available'}
              message={search || filter !== 'ALL'
                ? 'Try another search or status.'
                : online ? 'Create a new QC batch to get started.' : 'Sync while online to download batches.'}
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {filteredBatches.map((batch) => {
                const group = batch.batch_group_id
                  ? batches
                      .filter((item) => item.batch_group_id === batch.batch_group_id)
                      .sort((left, right) => left.batch_number.localeCompare(right.batch_number, undefined, { numeric: true }))
                  : [];
                const groupReadyCount = group.filter((item) => item.qr_job_id).length;
                return (
                  <BatchCard
                    key={batch.id}
                    batch={batch}
                    isQc={isQc}
                    canManageQr={canManageQr}
                    online={online}
                    printing={printJob === batch.id}
                    groupSize={group.length}
                    groupReadyCount={groupReadyCount}
                    isFirstInGroup={group.length > 1 && group[0].id === batch.id}
                    onFinish={() => openFinishGoods(batch)}
                    onReopen={() => {
                      setReopenBatch(batch);
                      setReopenReason('');
                      setError('');
                    }}
                    onPrint={() => void reprintLabels(batch)}
                    onPrintGroup={() => void reprintGroupLabels(group)}
                  />
                );
              })}
            </View>
          )}
        </Card>
      </ScrollView>

      <Modal visible={createVisible} animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <Screen>
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>BATCH MANAGEMENT</Text>
                <Text style={styles.modalTitle}>Create QC batches</Text>
              </View>
              <Pressable onPress={() => setCreateVisible(false)} hitSlop={10}>
                <Ionicons name="close-outline" size={26} color={colors.textMuted} />
              </Pressable>
            </View>
            <Card style={{ gap: spacing.md }}>
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
              <Text style={styles.helperText}>
                Each batch is tracked separately. Unit QR labels are available immediately after creation; finished-goods details can be added after QC passes.
              </Text>
              <SelectField
                label="Product *"
                value={createProductLabel}
                placeholder="Select a product"
                onPress={showProductPicker}
              />
              {selectedProduct ? (
                <View style={styles.productInfo}>
                  {selectedProduct.quantity != null ? <Text style={styles.productInfoText}>Stock {selectedProduct.quantity}</Text> : null}
                  {selectedProduct.cas_number ? <Text style={styles.productInfoText}>CAS {selectedProduct.cas_number}</Text> : null}
                  {selectedProduct.molecular_formula ? <Text style={styles.productInfoText}>{selectedProduct.molecular_formula}</Text> : null}
                  {selectedProduct.grade ? <Text style={styles.productInfoText}>{selectedProduct.grade}</Text> : null}
                </View>
              ) : null}
              <Field
                label="Batch number *"
                value={batchNumber}
                onChangeText={setBatchNumber}
                placeholder="Auto-generated after choosing product"
                autoCapitalize="characters"
              />
              <View style={styles.twoColumns}>
                <Field
                  label="Number of batches *"
                  value={batchCount}
                  onChangeText={setBatchCount}
                  keyboardType="number-pad"
                />
                <Field
                  label="Units per batch *"
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="number-pad"
                />
              </View>
              <Text style={styles.helperText}>
                {Number(batchCount) > 0 && Number(quantity) > 0
                  ? `${Number(batchCount) * Number(quantity)} total unit QR labels ready immediately`
                  : 'Maximum 10,000 units per creation.'}
              </Text>
              <View style={styles.twoColumns}>
                <Field
                  label="Unit price (₹)"
                  value={unitPrice}
                  onChangeText={setUnitPrice}
                  keyboardType="decimal-pad"
                />
                <SelectField
                  label="Shelf location"
                  value={locations.find((item) => String(item.id) === createLocationId)?.location_code || ''}
                  placeholder="No location"
                  onPress={() => openPicker(
                    'Shelf location',
                    [
                      { value: '', label: 'No location' },
                      ...locations.map((location) => ({ value: String(location.id), label: location.location_code })),
                    ],
                    createLocationId,
                    setCreateLocationId
                  )}
                />
              </View>
              <View style={styles.twoColumns}>
                <SelectField
                  label="Manufacturing date *"
                  value={manufacturingDate}
                  placeholder="Select date"
                  onPress={() => openDatePicker('manufacturing')}
                />
                <SelectField
                  label="Expiry date *"
                  value={expiryDate}
                  placeholder="Select date"
                  onPress={() => openDatePicker('expiry')}
                />
              </View>
              <Field
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                placeholder="Additional batch notes"
                multiline
                numberOfLines={3}
                style={{ minHeight: 78, textAlignVertical: 'top' }}
              />
              <Button
                title={loadingAction ? 'Creating batches...' : 'Create QC batches'}
                loading={loadingAction}
                disabled={!online}
                onPress={() => void createBatches()}
              />
            </Card>
          </ScrollView>
        </Screen>
      </Modal>

      {Platform.OS === 'android' && datePicker ? (
        <DateTimePicker
          value={dateDraft}
          mode="date"
          display="calendar"
          onValueChange={(_event, selectedDate) => handleDateValueChange(selectedDate)}
          onDismiss={() => setDatePicker(null)}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal
          visible={datePicker !== null}
          transparent
          animationType="slide"
          onRequestClose={() => setDatePicker(null)}
        >
          <View style={styles.modalShade}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setDatePicker(null)} />
            <View style={styles.datePickerSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {datePicker === 'manufacturing' ? 'Manufacturing date' : 'Expiry date'}
                </Text>
                <Pressable onPress={() => setDatePicker(null)} hitSlop={10}>
                  <Ionicons name="close-outline" size={24} color={colors.textMuted} />
                </Pressable>
              </View>
              <DateTimePicker
                value={dateDraft}
                mode="date"
                display="spinner"
                onValueChange={(_event, selectedDate) => handleDateValueChange(selectedDate)}
                onDismiss={() => setDatePicker(null)}
                style={styles.iosDatePicker}
              />
              <View style={styles.datePickerActions}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => setDatePicker(null)}
                />
                <Button
                  title="Set date"
                  style={{ flex: 1 }}
                  onPress={() => {
                    if (datePicker) savePickedDate(datePicker, dateDraft);
                    setDatePicker(null);
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      <Modal visible={!!finishBatch} animationType="slide" onRequestClose={() => setFinishBatch(null)}>
        <Screen>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>QC PASSED</Text>
                <Text style={styles.modalTitle}>Finish goods</Text>
                <Text style={styles.modalSubtitle}>{finishBatch?.batch_number} · {finishBatch?.product_name}</Text>
              </View>
              <Pressable onPress={() => setFinishBatch(null)} hitSlop={10}>
                <Ionicons name="close-outline" size={26} color={colors.textMuted} />
              </Pressable>
            </View>
            <Card style={{ gap: spacing.md }}>
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
              <Text style={styles.helperText}>
                Add finished-goods master details. One unique QR label will be generated for each of the {finishBatch?.quantity || 0} units.
              </Text>
              <SelectField
                label="Supplier *"
                value={vendorName(vendors, vendorId)}
                placeholder="Select a supplier"
                onPress={() => openPicker(
                  'Supplier',
                  vendors.map((vendor) => ({
                    value: String(vendor.id),
                    label: vendor.vendor_code === 'SELF' ? 'Self (Manufacturing Plant)' : vendor.name,
                  })),
                  vendorId,
                  setVendorId
                )}
              />
              <SelectField
                label="Grade *"
                value={grades.find((grade) => String(grade.id) === gradeId)?.name || ''}
                placeholder="Select a grade"
                onPress={() => openPicker(
                  'Grade',
                  grades.map((grade) => ({ value: String(grade.id), label: grade.name || `Grade ${grade.id}` })),
                  gradeId,
                  setGradeId
                )}
              />
              <SelectField
                label="Bag quantity *"
                value={bagQuantityLabel(bagQuantities, bagQuantityId)}
                placeholder="Select bag quantity"
                onPress={() => openPicker(
                  'Bag quantity',
                  bagQuantities.map((item) => ({
                    value: String(item.id),
                    label: `${item.quantity ?? ''} ${item.unit || ''}`.trim() || `Option ${item.id}`,
                  })),
                  bagQuantityId,
                  setBagQuantityId
                )}
              />
              <SelectField
                label="Godown / shelf location"
                value={locations.find((item) => String(item.id) === finishLocationId)?.location_code || ''}
                placeholder="No location"
                onPress={() => openPicker(
                  'Shelf location',
                  [
                    { value: '', label: 'No location' },
                    ...locations.map((location) => ({ value: String(location.id), label: location.location_code })),
                  ],
                  finishLocationId,
                  setFinishLocationId
                )}
              />
              {vendors.length === 0 || grades.length === 0 || bagQuantities.length === 0 ? (
                <View style={styles.warningBox}>
                  <Ionicons name="alert-circle-outline" size={17} color={colors.warning} />
                  <Text style={styles.warningText}>
                    Required supplier, grade, or bag-size values are unavailable. Add or activate them in the web app, then refresh.
                  </Text>
                </View>
              ) : null}
              <Button
                title={loadingAction ? 'Saving details...' : 'Save details & print QR labels'}
                loading={loadingAction}
                disabled={!online || !vendors.length || !grades.length || !bagQuantities.length}
                onPress={() => void finishGoods()}
                icon={<Ionicons name="print-outline" size={17} color="#fff" />}
              />
            </Card>
          </ScrollView>
        </Screen>
      </Modal>

      <Modal visible={!!reopenBatch} animationType="slide" transparent onRequestClose={() => setReopenBatch(null)}>
        <View style={styles.modalShade}>
          <View style={styles.confirmSheet}>
            <Text style={styles.eyebrow}>QC FOLLOW-UP</Text>
            <Text style={styles.modalTitle}>Send back for QC?</Text>
            <Text style={styles.modalSubtitle}>
              {reopenBatch?.batch_number} will return to the QC queue. A reason is required.
            </Text>
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            <Field
              label="Reason *"
              value={reopenReason}
              onChangeText={setReopenReason}
              placeholder="Describe why this batch needs re-testing"
              multiline
              numberOfLines={3}
              style={{ minHeight: 86, textAlignVertical: 'top' }}
            />
            <View style={styles.actionRow}>
              <Button title="Cancel" variant="secondary" onPress={() => setReopenBatch(null)} style={{ flex: 1 }} />
              <Button
                title="Send for re-QC"
                loading={loadingAction}
                disabled={!online || !reopenReason.trim()}
                onPress={() => void reopenForQc()}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <OptionPicker picker={picker} onClose={() => setPicker(null)} />
    </Screen>
  );
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function vendorName(vendors: MobileVendor[], id: string): string {
  const vendor = vendors.find((item) => String(item.id) === id);
  return vendor?.vendor_code === 'SELF' ? 'Self (Manufacturing Plant)' : vendor?.name || '';
}

function bagQuantityLabel(options: MobileMasterOption[], id: string): string {
  const option = options.find((item) => String(item.id) === id);
  return option ? `${option.quantity ?? ''} ${option.unit || ''}`.trim() : '';
}

function Metric({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={[styles.metricValue, { color: tint }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function BatchCard({
  batch,
  isQc,
  canManageQr,
  online,
  printing,
  groupSize,
  groupReadyCount,
  isFirstInGroup,
  onFinish,
  onReopen,
  onPrint,
  onPrintGroup,
}: {
  batch: Batch;
  isQc: boolean;
  canManageQr: boolean;
  online: boolean;
  printing: boolean;
  groupSize: number;
  groupReadyCount: number;
  isFirstInGroup: boolean;
  onFinish: () => void;
  onReopen: () => void;
  onPrint: () => void;
  onPrintGroup: () => void;
}) {
  const statusLabel = batch.status === 'CREATED'
    ? 'Waiting for QC'
    : batch.status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
  const canFinish = batch.status === 'QC_PASSED' && !batch.fg_details_completed_at;
  const canReopen = batch.status === 'QC_FAILED';
  const canPrint = !!batch.qr_job_id;

  return (
    <View style={styles.batchCard}>
      <View style={styles.batchCardHeader}>
        <View style={styles.batchProductIcon}>
          <Ionicons name="cube-outline" size={19} color={colors.info} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.batchProduct} numberOfLines={1}>{batch.product_name}</Text>
          <Text style={styles.batchSku} numberOfLines={1}>{batch.product_sku || 'No SKU'}</Text>
        </View>
        <Badge status={batch.status} label={statusLabel} />
      </View>
      <View style={styles.batchDetails}>
        <Text style={styles.batchNumber}>{batch.batch_number}</Text>
        <Text style={styles.batchMeta}>{batch.quantity} {batch.uom || 'units'}</Text>
        <Text style={styles.batchMeta}>
          {batch.vendor_name || 'Supplier not set'} · {batch.grade_name || batch.product_grade || 'Grade not set'}
        </Text>
        {batch.bag_quantity ? (
          <Text style={styles.batchMeta}>Bag size: {batch.bag_quantity} {batch.bag_quantity_unit || ''}</Text>
        ) : null}
        <View style={styles.dateRow}>
          <Text style={styles.batchDate}>MFG {batch.manufacturing_date ? formatDate(batch.manufacturing_date) : '-'}</Text>
          <Text style={styles.batchDate}>EXP {batch.expiry_date ? formatDate(batch.expiry_date) : '-'}</Text>
        </View>
        <Text style={styles.batchDate}>
          {batch.location_code || batch.storage_location || 'Location not set'}
          {batch.status === 'CREATED' ? ` · Waiting ${formatAge(batch.age_minutes)}` : ''}
        </Text>
      </View>
      {((isQc && (canFinish || canReopen)) || (canManageQr && canPrint)) ? (
        <View style={styles.batchActions}>
          {isQc && canFinish ? (
            <Button
              title="Finish goods details"
              small
              disabled={!online}
              icon={<Ionicons name="pricetag-outline" size={15} color="#fff" />}
              onPress={onFinish}
            />
          ) : null}
          {canManageQr && canPrint ? (
            <Button
              title={printing ? 'Preparing QR PDF...' : 'Download QR PDF'}
              variant="secondary"
              small
              loading={printing}
              disabled={!online || printing}
              icon={!printing ? <Ionicons name="download-outline" size={15} color={colors.text} /> : undefined}
              onPress={onPrint}
            />
          ) : null}
          {canManageQr && isFirstInGroup && groupSize > 1 && groupReadyCount === groupSize ? (
            <Button
              title={printing ? 'Preparing group PDF...' : `Download group QR (${groupSize})`}
              variant="secondary"
              small
              loading={printing}
              disabled={!online || printing}
              icon={!printing ? <Ionicons name="download-outline" size={15} color={colors.text} /> : undefined}
              onPress={onPrintGroup}
            />
          ) : null}
          {canManageQr && isFirstInGroup && groupSize > 1 && groupReadyCount < groupSize ? (
            <Text style={styles.groupProgress}>Group QR labels: {groupReadyCount}/{groupSize}</Text>
          ) : null}
          {isQc && canReopen ? (
            <Button
              title="Send for re-QC"
              variant="secondary"
              small
              disabled={!online}
              icon={<Ionicons name="refresh-outline" size={15} color={colors.text} />}
              onPress={onReopen}
            />
          ) : null}
        </View>
      ) : null}
      {canManageQr && batch.qr_job_id ? (
        <View style={styles.completedNote}>
          <Ionicons
            name={batch.fg_details_completed_at ? 'checkmark-circle-outline' : 'qr-code-outline'}
            size={15}
            color={batch.fg_details_completed_at ? colors.success : colors.primary}
          />
          <Text style={styles.completedText}>
            {batch.fg_details_completed_at ? 'Finished goods complete' : 'QR labels ready'}
            {' · '}{batch.qr_count ?? batch.quantity} unit labels
          </Text>
        </View>
      ) : null}
      <Text style={styles.createdDate}>Created {formatDate(batch.created_at)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, color: colors.primary },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: 4 },
  createButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  createButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusBannerText: { flex: 1, fontSize: 11, color: colors.textMuted },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.danger },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  successText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.success },
  statsRow: { flexDirection: 'row', gap: spacing.xs },
  metricCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 68,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 2,
    paddingVertical: spacing.sm,
  },
  metricValue: { fontSize: 19, fontWeight: '800' },
  metricLabel: { fontSize: 8, lineHeight: 11, color: colors.textMuted, textAlign: 'center', marginTop: 3 },
  filterRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  filterChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterChipText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  filterChipTextSelected: { color: colors.primaryDark },
  batchCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  batchCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  batchProductIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchProduct: { fontSize: 13, fontWeight: '800', color: colors.text },
  batchSku: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  batchDetails: { gap: 3, paddingLeft: 44 },
  batchNumber: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  batchMeta: { fontSize: 10, color: colors.textMuted },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md },
  batchDate: { fontSize: 10, color: colors.textFaint },
  createdDate: { fontSize: 9, color: colors.textFaint, textAlign: 'right' },
  batchActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  groupProgress: { alignSelf: 'center', fontSize: 10, color: colors.textFaint },
  completedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.successSoft,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  completedText: { fontSize: 10, color: colors.success, fontWeight: '600' },
  formContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 2 },
  modalSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
  helperText: { fontSize: 11, lineHeight: 16, color: colors.textMuted },
  productInfo: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  productInfoText: {
    color: colors.textMuted,
    fontSize: 10,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  twoColumns: { flexDirection: 'row', gap: spacing.sm },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.2 },
  selectField: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  selectText: { flex: 1, fontSize: 13, color: colors.text },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  warningText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.warning },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  modalShade: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
  },
  pickerSheet: {
    maxHeight: '78%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  datePickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  iosDatePicker: { alignSelf: 'center' },
  datePickerActions: { flexDirection: 'row', gap: spacing.sm },
  confirmSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
  optionDetail: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
});
