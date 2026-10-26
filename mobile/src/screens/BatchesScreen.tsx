import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
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
  EntityId,
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

type CreationSuccess = {
  response: CreateBatchesResponse;
  productName: string;
  productSku: string;
  batchNumber: string;
  batchCount: number;
  unitsPerBatch: number;
  totalUnits: number;
  unitPrice: number;
  manufacturingDate: string;
  expiryDate: string;
  location: string;
};

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
  const dateOnly = value.slice(0, 10);
  if (!isValidDate(dateOnly)) return null;
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateOnlyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateOnly(value?: string | null): string {
  const date = value ? dateFromDateOnly(value) : null;
  return date
    ? date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not set';
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
    const stored = batches.find((item) => String(item.id) === String(batch.id));
    if (!stored?.qr_job_id) {
      throw new Error(
        `Batch ${batch.batch_number} was created, but the server has not generated its unit QR labels yet. Deploy the latest backend, then retry.`
      );
    }
    const detail = await api.getQrJob(stored.qr_job_id);
    if (!detail.job || !Array.isArray(detail.labels) || detail.labels.length === 0) {
      throw new Error(`The server returned no QR labels for batch ${batch.batch_number}.`);
    }
    return { job: detail.job, labels: detail.labels };
  }));
}

async function downloadLabelSets(
  sets: { job: QrPrintJob; labels: QrLabel[] }[]
): Promise<'shared' | 'printed'> {
  const html = await labelSetsHtml(sets);
  const file = await Print.printToFileAsync({ html });
  try {
    if (await Sharing.isAvailableAsync()) {
      // Print writes under its own cache subdirectory. Copy to the app cache root
      // so Android's share provider can grant the receiving app read access.
      const shareFile = new File(Paths.cache, `qr-labels-${Date.now()}.pdf`);
      await new File(file.uri).copy(shareFile);
      await Sharing.shareAsync(shareFile.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Save QR labels PDF',
        UTI: 'com.adobe.pdf',
      });
      return 'shared';
    }
  } catch (error) {
    console.warn('Could not share QR label PDF; opening the print dialog instead.', error);
  }
  await Print.printAsync({ uri: file.uri });
  return 'printed';
}

async function printLabelSets(sets: { job: QrPrintJob; labels: QrLabel[] }[]): Promise<void> {
  const html = await labelSetsHtml(sets);
  const file = await Print.printToFileAsync({ html });
  await Print.printAsync({ uri: file.uri });
}

async function downloadLabelSetsOnly(sets: { job: QrPrintJob; labels: QrLabel[] }[]): Promise<void> {
  const html = await labelSetsHtml(sets);
  const file = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device. Choose Print now and select Save as PDF.');
  }
  // Share from the app cache root so Android grants the receiving app access.
  const shareFile = new File(Paths.cache, `qr-labels-${Date.now()}.pdf`);
  await new File(file.uri).copy(shareFile);
  await Sharing.shareAsync(shareFile.uri, {
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
  containerStyle,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.selectFieldContainer, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || placeholder}`} onPress={onPress} style={styles.selectField}>
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
            <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {picker.options.map((option) => {
              const selected = picker.value === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
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
  const [batchPage, setBatchPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createError, setCreateError] = useState('');
  const [creationSuccess, setCreationSuccess] = useState<CreationSuccess | null>(null);
  const [successPrintError, setSuccessPrintError] = useState('');
  const [successSyncWarning, setSuccessSyncWarning] = useState('');
  const [printingCreated, setPrintingCreated] = useState(false);
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
  const [printJob, setPrintJob] = useState<EntityId | null>(null);

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
        setBatchPage(1);
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
      setBatchPage(1);
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

  const batchPageSize = 10;
  const batchPageCount = Math.max(1, Math.ceil(filteredBatches.length / batchPageSize));
  const currentBatchPage = Math.min(batchPage, batchPageCount);
  const pageBatches = filteredBatches.slice(
    (currentBatchPage - 1) * batchPageSize,
    currentBatchPage * batchPageSize
  );

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
      setCreateError('Connect to the server to create QC batches.');
      return;
    }
    setCreateError('');
    const count = Number(batchCount);
    const units = Number(quantity);
    const price = Number(unitPrice || 0);
    if (!selectedProduct) {
      setCreateError('Choose a product before creating the batch.');
      return;
    }
    if (!batchNumber.trim()) {
      setCreateError('Enter a batch number.');
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setCreateError('Number of batches must be a whole number from 1 to 100.');
      return;
    }
    if (!Number.isInteger(units) || units < 1 || units > 1000 || units * count > 10000) {
      setCreateError('Products per batch must be 1–1,000 and one generation cannot exceed 10,000 products.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setCreateError('Enter a valid non-negative unit price.');
      return;
    }
    if (!manufacturingDate) {
      setCreateError('Select a manufacturing date.');
      return;
    }
    if (!isValidDate(manufacturingDate)) {
      setCreateError('The manufacturing date is invalid. Select it again.');
      return;
    }
    if (!expiryDate) {
      setCreateError('Select an expiry date.');
      return;
    }
    if (!isValidDate(expiryDate)) {
      setCreateError('The expiry date is invalid. Select it again.');
      return;
    }
    if (manufacturingDate >= expiryDate) {
      setCreateError('Manufacturing date must be before the expiry date.');
      return;
    }

    setLoadingAction(true);
    setError('');
    setNotice('');
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
        shelf_location_id: createLocationId || undefined,
      });
      setCreationSuccess({
        response: created,
        productName: selectedProduct.name,
        productSku: selectedProduct.sku,
        batchNumber: batchNumber.trim(),
        batchCount: count,
        unitsPerBatch: units,
        totalUnits: count * units,
        unitPrice: price,
        manufacturingDate,
        expiryDate,
        location: locations.find((item) => String(item.id) === createLocationId)?.location_code || 'Not set',
      });
      setSuccessPrintError('');
      setSuccessSyncWarning('');
      setCreateVisible(false);
      resetCreateForm();
      try {
        await sync();
        await load();
      } catch (err: any) {
        setSuccessSyncWarning(`Created successfully. Refresh did not finish: ${err?.message || 'Try syncing again.'}`);
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Could not create QC batches. Check the details and try again.');
    } finally {
      setLoadingAction(false);
    }
  };

  const printCreatedLabels = async () => {
    if (!creationSuccess) return;
    setPrintingCreated(true);
    setSuccessPrintError('');
    try {
      const labelSets = await createdBatchLabelSets(creationSuccess.response);
      await printLabelSets(labelSets);
    } catch (err: any) {
      setSuccessPrintError(err?.message || 'Could not prepare the QR label PDF. Try again.');
    } finally {
      setPrintingCreated(false);
    }
  };

  const downloadCreatedLabels = async () => {
    if (!creationSuccess) return;
    setPrintingCreated(true);
    setSuccessPrintError('');
    try {
      const labelSets = await createdBatchLabelSets(creationSuccess.response);
      await downloadLabelSetsOnly(labelSets);
    } catch (err: any) {
      setSuccessPrintError(err?.message || 'Could not prepare the QR label PDF. Try again.');
    } finally {
      setPrintingCreated(false);
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
        vendor_id: vendorId,
        grade_id: gradeId,
        bag_quantity_id: bagQuantityId,
        shelf_location_id: finishLocationId || undefined,
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
      const output = await downloadLabelSets([{ job: reprinted.job, labels: reprinted.labels }]);
      setNotice(output === 'shared'
        ? `${reprinted.labels.length} QR labels opened as a PDF for saving or sharing.`
        : `${reprinted.labels.length} QR labels opened in the print dialog. Choose Save as PDF to download them.`);
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
        const detail = await api.getQrJob(batch.qr_job_id!);
        return api.reprintQrLabels(
          batch.qr_job_id!,
          detail.labels.map((label) => label.id)
        );
      }));
      const output = await downloadLabelSets(labelSets.map((detail) => ({
        job: detail.job,
        labels: detail.labels,
      })));
      const labelCount = labelSets.reduce((total, detail) => total + detail.labels.length, 0);
      setNotice(output === 'shared'
        ? `${labelCount} QR labels across ${labelSets.length} batches opened as a PDF for saving or sharing.`
        : `${labelCount} QR labels across ${labelSets.length} batches opened in the print dialog. Choose Save as PDF to download them.`);
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
        setCreateError('');
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
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      setCreateError(`Choose a valid ${field === 'manufacturing' ? 'manufacturing' : 'expiry'} date.`);
      return;
    }
    const value = dateOnlyFromDate(date);
    const otherDate = field === 'manufacturing' ? expiryDate : manufacturingDate;
    if (field === 'manufacturing') setManufacturingDate(value);
    else setExpiryDate(value);
    setCreateError(otherDate && (field === 'manufacturing' ? value >= otherDate : otherDate >= value)
      ? 'Manufacturing date must be before the expiry date.'
      : '');
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
                ? 'Create batches, review the key dates and locations, and manage their QR labels.'
                : 'Browse batches synced to this device.'}
            </Text>
          </View>
          {isQc ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create a new batch"
              onPress={() => {
                setError('');
                setCreateError('');
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

        <View style={styles.inventorySection}>
          <SectionHeader
            title="Batch inventory"
            subtitle={`${filteredBatches.length} batches · ${batches.length} total`}
            right={<Badge status={online ? 'APPLIED' : 'PENDING'} label={online ? 'Live' : 'On device'} />}
          />
          <Field
            value={search}
            onChangeText={(value) => { setSearch(value); setBatchPage(1); }}
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
                  onPress={() => { setFilter(item.value); setBatchPage(1); }}
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
              {pageBatches.map((batch) => {
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
              {batchPageCount > 1 ? (
                <View style={styles.pagination}>
                  <Button
                    title="Previous"
                    small
                    variant="secondary"
                    disabled={currentBatchPage <= 1}
                    onPress={() => setBatchPage((value) => Math.max(1, value - 1))}
                  />
                  <Text style={styles.paginationText}>
                    {((currentBatchPage - 1) * batchPageSize) + 1}–{Math.min(currentBatchPage * batchPageSize, filteredBatches.length)} of {filteredBatches.length}
                  </Text>
                  <Button
                    title="Next"
                    small
                    variant="secondary"
                    disabled={currentBatchPage >= batchPageCount}
                    onPress={() => setBatchPage((value) => Math.min(batchPageCount, value + 1))}
                  />
                </View>
              ) : null}
            </View>
          )}
        </View>
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
              <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton} onPress={() => { setCreateVisible(false); setCreateError(''); }}>
                <Ionicons name="close-outline" size={26} color={colors.textMuted} />
              </Pressable>
            </View>
            <Card style={{ gap: spacing.md }}>
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
                onChangeText={(value) => { setBatchNumber(value); setCreateError(''); }}
                placeholder="Auto-generated after choosing product"
                autoCapitalize="characters"
              />
              <View style={styles.twoColumns}>
                <Field
                  containerStyle={{ flex: 1, minWidth: 0 }}
                  label="Number of batches *"
                  value={batchCount}
                  onChangeText={(value) => { setBatchCount(value); setCreateError(''); }}
                  keyboardType="number-pad"
                />
                <Field
                  containerStyle={{ flex: 1, minWidth: 0 }}
                  label="Units per batch *"
                  value={quantity}
                  onChangeText={(value) => { setQuantity(value); setCreateError(''); }}
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
                  containerStyle={{ flex: 1, minWidth: 0 }}
                  label="Unit price (₹)"
                  value={unitPrice}
                  onChangeText={(value) => { setUnitPrice(value); setCreateError(''); }}
                  keyboardType="decimal-pad"
                />
                <SelectField
                  containerStyle={{ flex: 1, minWidth: 0 }}
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
                    (value) => { setCreateLocationId(value); setCreateError(''); }
                  )}
                />
              </View>
              <View style={styles.twoColumns}>
                <SelectField
                  containerStyle={{ flex: 1, minWidth: 0 }}
                  label="Manufacturing date *"
                  value={manufacturingDate ? formatDateOnly(manufacturingDate) : ''}
                  placeholder="Select date"
                  onPress={() => openDatePicker('manufacturing')}
                />
                <SelectField
                  containerStyle={{ flex: 1, minWidth: 0 }}
                  label="Expiry date *"
                  value={expiryDate ? formatDateOnly(expiryDate) : ''}
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
              {createError ? (
                <View style={styles.errorBox} accessibilityRole="alert">
                  <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
                  <Text style={styles.errorText}>{createError}</Text>
                </View>
              ) : null}
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

      <Modal visible={!!creationSuccess} animationType="slide" onRequestClose={() => setCreationSuccess(null)}>
        <Screen>
          <View style={styles.successHeader}>
            <View style={styles.successHeaderSpacer} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss batch creation success"
              hitSlop={10}
              style={styles.successCloseButton}
              onPress={() => {
                setCreationSuccess(null);
                setSuccessPrintError('');
                setSuccessSyncWarning('');
              }}
            >
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.formContent}>
            <View style={styles.successHero}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark" size={30} color={colors.success} />
              </View>
              <Text style={styles.modalTitle}>Batch created</Text>
              <Text style={styles.modalSubtitle}>
                {creationSuccess?.batchCount === 1 ? 'Your batch is' : `${creationSuccess?.batchCount} batches are`} ready for QC.
              </Text>
            </View>
            {creationSuccess ? (
              <>
                <Card style={{ gap: spacing.md }}>
                  <SectionHeader title="Batch details" subtitle={creationSuccess.productName} />
                  <View style={styles.summaryGrid}>
                    <BatchDetail label="Product SKU" value={creationSuccess.productSku || 'Not set'} />
                    <BatchDetail label="Batch count" value={String(creationSuccess.batchCount)} />
                    <BatchDetail label="Starting batch number" value={creationSuccess.batchNumber} />
                    <BatchDetail label="Units per batch" value={String(creationSuccess.unitsPerBatch)} />
                    <BatchDetail label="Unit QR labels" value={String(creationSuccess.totalUnits)} />
                    <BatchDetail label="Unit price" value={`₹${creationSuccess.unitPrice.toFixed(2)}`} />
                    <BatchDetail label="Manufacturing date" value={formatDateOnly(creationSuccess.manufacturingDate)} />
                    <BatchDetail label="Expiry date" value={formatDateOnly(creationSuccess.expiryDate)} />
                    <BatchDetail label="Shelf location" value={creationSuccess.location} />
                  </View>
                </Card>
                <Card style={{ gap: spacing.sm }}>
                  <SectionHeader title="Created batch numbers" />
                  {creationSuccess.response.batches.slice(0, 5).map((batch) => (
                    <View key={String(batch.id)} style={styles.createdBatchRow}>
                      <Ionicons name="cube-outline" size={17} color={colors.primary} />
                      <Text style={styles.createdBatchNumber}>{batch.batch_number}</Text>
                    </View>
                  ))}
                  {creationSuccess.response.batches.length > 5 ? (
                    <Text style={styles.helperText}>And {creationSuccess.response.batches.length - 5} more batch numbers.</Text>
                  ) : null}
                  <Text style={styles.helperText}>Each batch has {creationSuccess.unitsPerBatch} unique unit QR labels.</Text>
                </Card>
              </>
            ) : null}
            {successSyncWarning ? (
              <View style={styles.warningBox}>
                <Ionicons name="cloud-offline-outline" size={17} color={colors.warning} />
                <Text style={styles.warningText}>{successSyncWarning}</Text>
              </View>
            ) : null}
            {successPrintError ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
                <Text style={styles.errorText}>{successPrintError}</Text>
              </View>
            ) : null}
            <View style={styles.actionRow}>
              <Button
                title={printingCreated ? 'Preparing PDF...' : 'Download'}
                variant="secondary"
                style={{ flex: 1 }}
                loading={printingCreated}
                disabled={printingCreated}
                icon={!printingCreated ? <Ionicons name="download-outline" size={17} color={colors.text} /> : undefined}
                onPress={() => void downloadCreatedLabels()}
              />
              <Button
                title={printingCreated ? 'Preparing PDF...' : 'Print now'}
                loading={printingCreated}
                disabled={printingCreated}
                style={{ flex: 1 }}
                icon={!printingCreated ? <Ionicons name="print-outline" size={17} color="#fff" /> : undefined}
                onPress={() => void printCreatedLabels()}
              />
            </View>
            <Text style={styles.downloadLaterHint}>
              You can download these QR labels later from the Batches page.
            </Text>
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
                <Pressable accessibilityRole="button" accessibilityLabel="Close date picker" style={styles.closeButton} onPress={() => setDatePicker(null)}>
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
            <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton} onPress={() => setFinishBatch(null)}>
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
      <View style={styles.batchMainInfo}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.fieldLabel}>BATCH NUMBER</Text>
          <Text style={styles.batchNumber} numberOfLines={2}>{batch.batch_number}</Text>
        </View>
        <View style={styles.quantityPill}>
          <Text style={styles.quantityValue}>{batch.quantity} {batch.uom || 'units'}</Text>
          <Text style={styles.quantityLabel}>Quantity</Text>
        </View>
      </View>
      <View style={styles.batchInfoGrid}>
        <BatchDetail label="Manufacturing" value={formatDateOnly(batch.manufacturing_date)} />
        <BatchDetail label="Expiry" value={formatDateOnly(batch.expiry_date)} />
        <BatchDetail label="Supplier" value={batch.vendor_name || 'Not set'} />
        <BatchDetail label="Grade" value={batch.grade_name || batch.product_grade || 'Not set'} />
        <BatchDetail label="Shelf location" value={batch.location_code || batch.storage_location || 'Not set'} />
        {batch.bag_quantity ? (
          <BatchDetail label="Bag size" value={`${batch.bag_quantity} ${batch.bag_quantity_unit || ''}`.trim()} />
        ) : null}
      </View>
      {batch.status === 'CREATED' ? (
        <View style={styles.waitingNote}>
          <Ionicons name="time-outline" size={15} color={colors.warning} />
          <Text style={styles.waitingText}>Waiting for QC · {formatAge(batch.age_minutes)}</Text>
        </View>
      ) : null}
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

function BatchDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailCell}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>{value || 'Not set'}</Text>
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
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  createButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
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
  statusBannerText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.textMuted },
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
  metricLabel: { fontSize: 10, lineHeight: 13, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  filterRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  inventorySection: { gap: spacing.md },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.xs },
  paginationText: { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  filterChip: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  filterChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterChipText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
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
  batchProduct: { fontSize: 14, fontWeight: '800', color: colors.text },
  batchSku: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  batchMainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  batchNumber: { fontSize: 14, fontWeight: '800', color: colors.primaryDark, marginTop: 3 },
  quantityPill: {
    minWidth: 86,
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  quantityValue: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  quantityLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  batchInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginHorizontal: -spacing.xs },
  detailCell: { width: '50%', paddingHorizontal: spacing.xs, gap: 2 },
  detailLabel: { color: colors.textFaint, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  detailValue: { color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  waitingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  waitingText: { color: colors.warning, fontSize: 12, fontWeight: '700' },
  batchDate: { fontSize: 12, color: colors.textFaint },
  createdDate: { fontSize: 11, color: colors.textFaint, textAlign: 'right' },
  batchActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  groupProgress: { alignSelf: 'center', fontSize: 12, color: colors.textFaint },
  completedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.successSoft,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  completedText: { fontSize: 12, color: colors.success, fontWeight: '600' },
  formContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  successHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  successHeaderSpacer: { width: 44, height: 44 },
  successCloseButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  successHero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  successIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successSoft,
    marginBottom: spacing.xs,
  },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, marginHorizontal: -spacing.xs },
  createdBatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  createdBatchNumber: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 2 },
  modalSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
  helperText: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  downloadLaterHint: { color: colors.textFaint, fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: spacing.md },
  productInfo: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  productInfoText: {
    color: colors.textMuted,
    fontSize: 12,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  twoColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.2 },
  selectField: {
    minHeight: 52,
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
  selectFieldContainer: { gap: spacing.xs },
  selectText: { flex: 1, fontSize: 13, color: colors.text },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.warning },
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
  optionDetail: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
