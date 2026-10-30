import { AlertTriangle, QrCode, ScanLine, X } from 'lucide-react-native';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BatchRecord } from '@/services/batches';

import { AppText } from './app-text';
import { PrimaryButton } from './buttons';
import { StatusBadge } from './status-badge';

type FieldConfig = {
  key: string;
  label: string;
};

type FieldSection = {
  title: string;
  fields: FieldConfig[];
};

/**
 * Every field returned by GET /batches/barcode/:barcode is grouped here.
 * Anything the API adds later falls through to the "Other details" section so
 * the screen never silently hides information.
 */
const FIELD_SECTIONS: FieldSection[] = [
  {
    title: 'Product',
    fields: [
      { key: 'product_name', label: 'Product name' },
      { key: 'product_id', label: 'Product ID' },
      { key: 'product_sku', label: 'SKU' },
      { key: 'product_description', label: 'Description' },
      { key: 'product_purity', label: 'Purity' },
      { key: 'product_grade', label: 'Product grade' },
      { key: 'product_physical_state', label: 'Physical state' },
      { key: 'cas_number', label: 'CAS number' },
      { key: 'molecular_formula', label: 'Molecular formula' },
      { key: 'hazard_classification', label: 'Hazard classification' },
      { key: 'hsn_code', label: 'HSN code' },
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'product_storage_conditions', label: 'Storage conditions' },
    ],
  },
  {
    title: 'Batch',
    fields: [
      { key: 'batch_number', label: 'Batch number' },
      { key: 'id', label: 'Batch ID' },
      { key: 'status', label: 'Status' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'uom', label: 'Unit of measure' },
      { key: 'unit_price', label: 'Unit price' },
      { key: 'qr_count', label: 'Unit QR codes in batch' },
      { key: 'qr_job_id', label: 'QR print job ID' },
      { key: 'barcode_value', label: 'Batch barcode' },
      { key: 'batch_group_id', label: 'Batch group ID' },
      { key: 'manufacturing_date', label: 'Manufacturing date' },
      { key: 'expiry_date', label: 'Expiry date' },
      { key: 'fg_details_completed_at', label: 'Finished-goods details completed' },
      { key: 'created_at', label: 'Batch created' },
      { key: 'updated_at', label: 'Last updated' },
      { key: 'notes', label: 'Notes' },
    ],
  },
  {
    title: 'Storage & vendor',
    fields: [
      { key: 'location_code', label: 'Shelf location' },
      { key: 'storage_location', label: 'Storage location' },
      { key: 'shelf_location_id', label: 'Shelf location ID' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'vendor_id', label: 'Vendor ID' },
      { key: 'grade_name', label: 'Grade' },
      { key: 'grade_id', label: 'Grade ID' },
      { key: 'bag_quantity_name', label: 'Bag quantity type' },
      { key: 'bag_quantity', label: 'Bag quantity' },
      { key: 'bag_quantity_unit', label: 'Bag quantity unit' },
      { key: 'bag_quantity_id', label: 'Bag quantity ID' },
    ],
  },
  {
    title: 'Scan match',
    fields: [
      { key: 'scanned_qr', label: 'Matched unit QR' },
      { key: 'matched_by_batch_number', label: 'Matched by batch number' },
    ],
  },
];

const CONFIGURED_KEYS = new Set(FIELD_SECTIONS.flatMap((section) => section.fields.map((field) => field.key)));

const DATE_ONLY_KEYS = new Set(['manufacturing_date', 'expiry_date']);

function labelFromKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: Date, withTime: boolean): string {
  return withTime
    ? value.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : value.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  if (key === 'matched_by_batch_number') {
    return Number(value) ? 'Yes' : 'No';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (key === 'unit_price' || key === 'price') {
    const price = Number(value);
    return Number.isFinite(price) ? `₹ ${price.toLocaleString('en-IN')}` : String(value);
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  const text = String(value);
  if (DATE_ONLY_KEYS.has(key) || key.endsWith('_date')) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return formatDate(date, false);
  }
  if (key.endsWith('_at')) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return formatDate(date, true);
  }

  return text;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start gap-3 border-b border-line py-2 last:border-b-0">
      <AppText
        variant="tiny"
        className="flex-1 text-[10.5px] leading-[15px] text-[#71829B]">
        {label}
      </AppText>
      <AppText
        selectable
        className="max-w-[60%] text-right text-[11.5px] leading-[16px] font-manrope-semibold text-navy">
        {value}
      </AppText>
    </View>
  );
}

function DetailSection({
  title,
  fields,
  record,
}: {
  title: string;
  fields: FieldConfig[];
  record: BatchRecord;
}) {
  const visibleFields = fields.filter((field) => record[field.key] !== undefined);
  if (visibleFields.length === 0) return null;

  return (
    <View className="mt-4">
      <AppText variant="label" className="mb-1 text-[10.5px] uppercase tracking-wider text-[#71829B]">
        {title}
      </AppText>
      <View className="rounded-2xl border border-[#D4E3FA] bg-white px-3.5">
        {visibleFields.map((field) => (
          <DetailRow
            key={field.key}
            label={field.label}
            value={formatValue(field.key, record[field.key])}
          />
        ))}
      </View>
    </View>
  );
}

type QrDetailsSheetProps = {
  visible: boolean;
  code: string;
  batch: BatchRecord | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onRetry?: () => void;
  onScanAgain?: () => void;
};

export function QrDetailsSheet({
  visible,
  code,
  batch,
  loading = false,
  error = null,
  onClose,
  onRetry,
  onScanAgain,
}: QrDetailsSheetProps) {
  const insets = useSafeAreaInsets();

  const otherFields = batch
    ? Object.keys(batch).filter((key) => !CONFIGURED_KEYS.has(key))
    : [];
  const additionalFields: FieldConfig[] = otherFields.map((key) => ({
    key,
    label: labelFromKey(key),
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/45">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Close QR details" />
        <View
          className="w-full self-center rounded-t-[26px] bg-[#F7FAFF]"
          style={{
            maxWidth: 560,
            height: '88%',
            paddingBottom: Math.max(insets.bottom, 16),
          }}>
          <View className="flex-row items-start justify-between border-b border-line bg-white px-5 pb-3 pt-5">
            <View className="flex-1 pr-3">
              <AppText variant="h2" className="text-[18px]">
                QR Code Details
              </AppText>
              <AppText variant="caption" className="mt-0.5 text-[11px]">
                Everything linked to this scanned label
              </AppText>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close QR details"
              className="h-9 w-9 items-center justify-center rounded-full bg-canvas">
              <X size={18} color="#001A6E" />
            </Pressable>
          </View>

          <ScrollView
            className="flex-1"
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}>
            <View className="mt-4 rounded-2xl border border-[#CCDDF5] bg-white p-3.5">
              <View className="flex-row items-center gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-lg bg-[#EBF3FF]">
                  <QrCode size={16} color="#011A87" />
                </View>
                <View className="flex-1">
                  <AppText variant="tiny" className="text-[10px] uppercase tracking-wider text-[#71829B]">
                    Scanned value
                  </AppText>
                  <AppText
                    selectable
                    className="mt-0.5 text-[12px] font-manrope-bold text-navy">
                    {code || '—'}
                  </AppText>
                </View>
              </View>
            </View>

            {loading ? (
              <View className="items-center gap-3 rounded-2xl border border-[#D4E3FA] bg-white px-6 py-10">
                <ActivityIndicator color="#011A87" size="large" />
                <AppText variant="h3" className="text-[14px]">
                  Looking up QR details…
                </AppText>
                <AppText variant="caption" className="text-center text-[11px]">
                  Matching this label against its product, batch and storage records.
                </AppText>
              </View>
            ) : error ? (
              <View className="mt-4 rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] p-4">
                <View className="flex-row items-start gap-2">
                  <AlertTriangle size={18} color="#DC2626" />
                  <View className="flex-1">
                    <AppText className="text-[12.5px] font-manrope-bold text-[#B91C1C]">
                      Details not found
                    </AppText>
                    <AppText className="mt-1 text-[11px] leading-[16px] text-[#7F1D1D]">
                      {error}
                    </AppText>
                  </View>
                </View>
                {onRetry ? (
                  <PrimaryButton
                    label="Try again"
                    size="md"
                    variant="outline"
                    className="mt-3"
                    onPress={onRetry}
                  />
                ) : null}
              </View>
            ) : batch ? (
              <>
                <View className="mt-4 rounded-2xl border border-[#CCDDF5] bg-white p-4">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <AppText
                        className="text-[17px] text-navy"
                        style={{ fontFamily: 'Manrope_800ExtraBold' }}>
                        {batch.product_name || 'Product'}
                      </AppText>
                      <AppText variant="caption" className="mt-0.5 text-[11px]">
                        {batch.product_sku ? `SKU ${batch.product_sku}` : 'SKU not set'}
                      </AppText>
                    </View>
                    {batch.status ? (
                      <StatusBadge status={batch.status} label={String(batch.status)} />
                    ) : null}
                  </View>
                  <View className="mt-3 flex-row flex-wrap gap-1.5">
                    <View className="rounded-full bg-[#EBF3FF] px-2.5 py-1">
                      <AppText className="text-[10px] font-manrope-bold text-navy">
                        Batch {batch.batch_number || 'N/A'}
                      </AppText>
                    </View>
                    <View className="rounded-full bg-[#F0F5FD] px-2.5 py-1">
                      <AppText className="text-[10px] font-manrope-bold text-[#4E5D76]">
                        {batch.quantity ?? '—'} {batch.uom || 'units'}
                      </AppText>
                    </View>
                    <View className="rounded-full bg-[#F0F5FD] px-2.5 py-1">
                      <AppText className="text-[10px] font-manrope-bold text-[#4E5D76]">
                        {batch.qr_count ?? '—'} unit QR codes
                      </AppText>
                    </View>
                  </View>
                </View>

                {FIELD_SECTIONS.map((section) => (
                  <DetailSection
                    key={section.title}
                    title={section.title}
                    fields={section.fields}
                    record={batch}
                  />
                ))}

                {additionalFields.length > 0 ? (
                  <DetailSection
                    title="Other details"
                    fields={additionalFields}
                    record={batch}
                  />
                ) : null}
              </>
            ) : null}
          </ScrollView>

          {!loading && !error && !batch ? (
            <View className="px-5 pb-2">
              <View className="rounded-2xl border border-[#D4E3FA] bg-white p-4">
                <AppText className="text-[12px] font-manrope-bold text-navy">
                  No details were returned for this QR code.
                </AppText>
                <AppText className="mt-1 text-[11px] leading-[16px] text-[#71829B]">
                  The code may not be linked to a product or batch yet. Ask the packing team to
                  reprint the label or verify the code value.
                </AppText>
              </View>
            </View>
          ) : null}

          <View className="border-t border-line bg-white px-5 pt-3">
            {onScanAgain ? (
              <PrimaryButton
                label="Scan another QR code"
                icon={ScanLine}
                onPress={onScanAgain}
              />
            ) : null}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close QR details"
              className="mt-2 items-center py-2">
              <AppText className="text-[12px] font-manrope-bold text-[#4E5D76]">Close</AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
