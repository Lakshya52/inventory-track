import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import {
  ChevronRight,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react-native';

import { AppText } from '@/components/ui/app-text';
import { IconTile, PrimaryButton } from '@/components/ui/buttons';
import { BackHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { apiRequest } from '@/services/api';
import { colors } from '@/theme';

type Product = {
  id: string;
  name: string;
  sku: string;
  description?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  cas_number?: string | null;
  molecular_formula?: string | null;
  purity?: string | null;
  grade?: string | null;
  storage_conditions?: string | null;
  hazard_classification?: string | null;
  physical_state?: string | null;
  hsn_code?: string | null;
  manufacturer?: string | null;
};

/** A product at or below this quantity is shown as "Low Stock". */
const LOW_STOCK_THRESHOLD = 20;

type StockFilter = 'all' | 'in' | 'low' | 'out';

function quantityOf(product: Product) {
  const value = Number(product.quantity ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function priceOf(product: Product) {
  const value = Number(product.price ?? 0);
  return Number.isFinite(value) ? value : 0;
}

type StockStatus = 'in' | 'low' | 'out';

function stockStatusOf(product: Product): StockStatus {
  const quantity = quantityOf(product);
  if (quantity <= 0) return 'out';
  if (quantity <= LOW_STOCK_THRESHOLD) return 'low';
  return 'in';
}

function formatQuantity(quantity: number) {
  return Number.isInteger(quantity) ? quantity : Number(quantity.toFixed(2));
}

type FieldConfig = {
  key: string;
  label: string;
  placeholder: string;
  numeric?: boolean;
  multiline?: boolean;
};

const sections: {
  title: string;
  fields: FieldConfig[];
}[] = [
  {
    title: 'Basic Information',
    fields: [
      { key: 'name', label: 'Product Name *', placeholder: 'e.g. Sodium Hydroxide' },
      { key: 'sku', label: 'SKU / Product Code *', placeholder: 'e.g. CHEM-001' },
      { key: 'description', label: 'Description', placeholder: 'Enter product description...', multiline: true },
    ],
  },
  {
    title: 'Stock & Pricing',
    fields: [
      { key: 'quantity', label: 'Quantity', placeholder: 'Enter quantity', numeric: true },
      { key: 'price', label: 'Price (₹)', placeholder: 'Enter unit price', numeric: true },
      { key: 'hsn_code', label: 'HSN Code', placeholder: 'Enter HSN code' },
    ],
  },
  {
    title: 'Chemical Specifications',
    fields: [
      { key: 'cas_number', label: 'CAS Number', placeholder: 'e.g. 7664-93-9' },
      { key: 'molecular_formula', label: 'Molecular Formula', placeholder: 'e.g. H2SO4' },
      { key: 'purity', label: 'Purity', placeholder: 'e.g. 99%' },
      { key: 'grade', label: 'Grade', placeholder: 'e.g. Industrial Grade' },
      { key: 'physical_state', label: 'Physical State', placeholder: 'e.g. Liquid, Solid, Powder' },
    ],
  },
  {
    title: 'Storage & Safety',
    fields: [
      { key: 'storage_conditions', label: 'Storage Conditions', placeholder: 'Enter storage requirements...', multiline: true },
      { key: 'hazard_classification', label: 'Hazard Classification', placeholder: 'e.g. Corrosive, Flammable' },
      { key: 'manufacturer', label: 'Manufacturer / Supplier', placeholder: 'Enter manufacturer name' },
    ],
  },
];

const allFields = sections.flatMap((section) => section.fields);

const emptyValues: Record<string, string> = Object.fromEntries(
  allFields.map((field) => [field.key, '']),
);

function toFormValues(product?: Product): Record<string, string> {
  if (!product) return { ...emptyValues };

  return Object.fromEntries(
    allFields.map((field) => [
      field.key,
      product[field.key as keyof Product] == null
        ? ''
        : String(product[field.key as keyof Product]),
    ]),
  );
}

function toPayload(values: Record<string, string>) {
  return {
    ...values,
    name: values.name?.trim() ?? '',
    sku: values.sku?.trim() ?? '',
    quantity: values.quantity?.trim() ? Number(values.quantity) : 0,
    price: values.price?.trim() ? Number(values.price) : 0,
  };
}

function ProductField({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <AppText
        className="mb-2 text-[12px] text-muted"
        style={{ fontFamily: 'Manrope_600SemiBold' }}
      >
        {field.label}
      </AppText>

      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={field.placeholder}
        placeholderTextColor="#9AA6B8"
        keyboardType={field.numeric ? 'decimal-pad' : 'default'}
        multiline={field.multiline}
        textAlignVertical={field.multiline ? 'top' : 'center'}
        accessibilityLabel={field.label}
        className="text-[15px] text-navy"
        style={{
          backgroundColor: '#F7F9FC',
          borderRadius: 16,
          minHeight: field.multiline ? 104 : 54,
          paddingHorizontal: 18,
          paddingTop: field.multiline ? 15 : 0,
          paddingBottom: field.multiline ? 15 : 0,
          fontFamily: 'Manrope_500Medium',
        }}
      />
    </View>
  );
}

function ProductForm({
  visible,
  product,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  product: Product | null;
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => toFormValues(product ?? undefined));
  const [formError, setFormError] = useState('');

  if (!visible) return null;

  const update = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFormError('');
  };

  const renderField = (field: FieldConfig) => (
    <ProductField
      key={field.key}
      field={field}
      value={values[field.key] ?? ''}
      onChange={(value) => update(field.key, value)}
    />
  );

  const handleSave = () => {
    if (!values.name?.trim() || !values.sku?.trim()) {
      setFormError('Product Name and SKU are required.');
      return;
    }

    const quantity = values.quantity?.trim() ? Number(values.quantity) : 0;
    const price = values.price?.trim() ? Number(values.price) : 0;

    if (
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      setFormError('Quantity and price must be valid non-negative numbers.');
      return;
    }

    onSave(values);
  };

  return (
    <View className="absolute inset-0 z-50 bg-white">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Fixed header */}
        <View className="flex-row items-center justify-between px-5 pb-3 pt-5">
          <View className="flex-1 pr-3">
            <AppText
              className="text-[24px] text-navy"
              style={{ fontFamily: 'Manrope_800ExtraBold' }}
            >
              {product ? 'Edit Product' : 'New Product'}
            </AppText>
            <AppText variant="body" className="mt-1 text-[12px]">
              {product
                ? 'Update the product details below'
                : 'Fill in the details to add a product'}
            </AppText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close product form"
            disabled={saving}
            onPress={onClose}
            style={({ pressed }) => ({
              height: 40,
              width: 40,
              borderRadius: 20,
              backgroundColor: '#EFF3F9',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <X size={19} color={colors.navy} strokeWidth={2.1} />
          </Pressable>
        </View>

        {/* Scrollable single-page form */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: 40,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {sections.map((section) => (
            <View key={section.title} style={{ marginBottom: 28 }}>
              <AppText
                className="mb-3 text-[11px] uppercase tracking-[1.4px] text-faint"
                style={{ fontFamily: 'Manrope_700Bold' }}
              >
                {section.title}
              </AppText>

              {section.title === 'Stock & Pricing' ? (
                <>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      {renderField(section.fields[0])}
                    </View>
                    <View style={{ flex: 1 }}>
                      {renderField(section.fields[1])}
                    </View>
                  </View>
                  {renderField(section.fields[2])}
                </>
              ) : section.title === 'Chemical Specifications' ? (
                <>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      {renderField(section.fields[0])}
                    </View>
                    <View style={{ flex: 1 }}>
                      {renderField(section.fields[1])}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      {renderField(section.fields[2])}
                    </View>
                    <View style={{ flex: 1 }}>
                      {renderField(section.fields[3])}
                    </View>
                  </View>
                  {renderField(section.fields[4])}
                </>
              ) : (
                section.fields.map(renderField)
              )}
            </View>
          ))}

          {formError ? (
            <View
              className="mb-2"
              style={{
                borderRadius: 18,
                backgroundColor: '#FFE8EC',
                paddingVertical: 12,
                paddingHorizontal: 16,
              }}
            >
              <AppText className="text-[13px] text-[#DD4350]">{formError}</AppText>
            </View>
          ) : null}

          {/* Actions (part of the page, not frozen) */}
          <View style={{ marginTop: 16 }}>
            <PrimaryButton
              label={
                saving
                  ? 'Saving...'
                  : product
                    ? 'Save Changes'
                    : 'Add Product'
              }
              icon={saving ? undefined : Plus}
              className="h-[54px] rounded-full"
              labelClassName="text-[16px]"
              disabled={saving}
              onPress={handleSave}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close product form"
              disabled={saving}
              onPress={onClose}
              className="mt-2 h-11 items-center justify-center"
              style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
            >
              <AppText
                className="text-[14px] text-muted"
                style={{ fontFamily: 'Manrope_600SemiBold' }}
              >
                Cancel
              </AppText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Product details (minimalist premium view) ─────────────────────────────

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        backgroundColor: '#F7F9FC',
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 14,
      }}
    >
      <AppText variant="tiny" className="text-[10px] uppercase tracking-[0.8px]">
        {label}
      </AppText>
      <AppText
        className="mt-1 text-[13px] leading-[18px] text-navy"
        numberOfLines={2}
        style={{ fontFamily: 'Manrope_700Bold' }}
      >
        {value}
      </AppText>
    </View>
  );
}

function ProductDetails({
  product,
  onClose,
  onEdit,
  onDelete,
}: {
  product: Product;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const quantity = quantityOf(product);
  const price = priceOf(product);
  const status = stockStatusOf(product);
  const category = product.grade || product.physical_state || 'Chemical';
  const formattedQty = status === 'out' ? '0 kg' : `${formatQuantity(quantity)} kg`;
  const formattedPrice =
    price > 0 ? `₹ ${price.toLocaleString('en-IN')} / kg` : 'Price not set';

  /** Only fields that actually have a value are shown in the grid. */
  const specs: { label: string; value: string }[] = [
    { label: 'Quantity', value: formattedQty },
  ];

  if (price > 0) {
    specs.push({ label: 'Price / kg', value: `₹ ${price.toLocaleString('en-IN')}` });
  }

  if (product.grade) specs.push({ label: 'Grade', value: product.grade });
  if (product.physical_state) specs.push({ label: 'Physical State', value: product.physical_state });
  if (product.cas_number) specs.push({ label: 'CAS Number', value: product.cas_number });
  if (product.molecular_formula) specs.push({ label: 'Molecular Formula', value: product.molecular_formula });
  if (product.purity) specs.push({ label: 'Purity', value: product.purity });
  if (product.hsn_code) specs.push({ label: 'HSN Code', value: product.hsn_code });
  if (product.manufacturer) specs.push({ label: 'Manufacturer', value: product.manufacturer });
  if (product.storage_conditions) specs.push({ label: 'Storage', value: product.storage_conditions });
  if (product.hazard_classification) specs.push({ label: 'Hazard', value: product.hazard_classification });

  return (
    <View className="absolute inset-0 z-40 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between pt-5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close product details"
            onPress={onClose}
            style={({ pressed }) => ({
              height: 40,
              width: 40,
              borderRadius: 20,
              backgroundColor: '#EFF3F9',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <X size={19} color={colors.navy} strokeWidth={2.1} />
          </Pressable>

          <AppText variant="label" className="text-[12px] tracking-[1px]">
            PRODUCT DETAILS
          </AppText>

          <View style={{ width: 40 }} />
        </View>

        {/* Hero */}
        <View className="mt-6">
          <AppText
            className="text-[26px] leading-[32px] text-navy"
            style={{ fontFamily: 'Manrope_800ExtraBold' }}
          >
            {product.name}
          </AppText>

          <AppText variant="body" className="mt-1.5 text-[12px]">
            {product.sku} • {category} • {formattedQty}
          </AppText>

          <View className="mt-4 flex-row items-center">
            <StockBadge status={status} />
            <AppText
              className="ml-2 text-[15px] text-navy"
              style={{ fontFamily: 'Manrope_800ExtraBold' }}
            >
              {formattedPrice}
            </AppText>
          </View>
        </View>

        {product.description ? (
          <AppText variant="body" className="mt-4 text-[12px] leading-[19px]">
            {product.description}
          </AppText>
        ) : null}

        {/* Spec grid — 2 columns */}
        <View className="mt-5">
          {Array.from({ length: Math.ceil(specs.length / 2) }, (_, row) => {
            const left = specs[row * 2];
            const right = specs[row * 2 + 1];

            return (
              <View key={left.label} style={{ flexDirection: 'row', marginBottom: 10 }}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <DetailCell label={left.label} value={left.value} />
                </View>
                <View style={{ flex: 1 }}>
                  {right ? <DetailCell label={right.label} value={right.value} /> : null}
                </View>
              </View>
            );
          })}
        </View>

        {/* Actions (part of the page, not frozen) */}
        <View style={{ flexDirection: 'row', marginTop: 24 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${product.name}`}
            onPress={onDelete}
            style={({ pressed }) => ({
              height: 54,
              width: 54,
              borderRadius: 27,
              backgroundColor: '#FFE8EC',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Trash2 size={19} color="#DD4350" strokeWidth={2} />
          </Pressable>

          <PrimaryButton
            label="Edit Product"
            icon={Pencil}
            iconSize={17}
            className="h-[54px] flex-1 rounded-full"
            labelClassName="text-[16px]"
            onPress={onEdit}
          />
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Stock badge (dot + label pill like the design) ────────────────────────

const stockBadgePalette: Record<StockStatus, { background: string; dot: string; color: string }> = {
  in: { background: '#E4F8EE', dot: '#17B26A', color: '#178A52' },
  low: { background: '#FFF3E4', dot: '#F5A524', color: '#B26A16' },
  out: { background: '#FFE8EC', dot: '#F04452', color: '#DD4350' },
};

function StockBadge({ status }: { status: StockStatus }) {
  const palette = stockBadgePalette[status];
  const label = status === 'in' ? 'In Stock' : status === 'low' ? 'Low Stock' : 'Out of Stock';

  return (
    <View
      style={{
        backgroundColor: palette.background,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: palette.dot,
          marginRight: 5,
        }}
      />
      <AppText variant="tiny" className="text-[10px] leading-[13px]" style={{ color: palette.color }}>
        {label}
      </AppText>
    </View>
  );
}

// ─── Filter chip with count pill ───────────────────────────────────────────

const filterOptions: { key: StockFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'In Stock' },
  { key: 'low', label: 'Low Stock' },
  { key: 'out', label: 'Out of Stock' },
];

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Filter ${label}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        height: 34,
        borderRadius: 999,
        borderWidth: 1.4,
        borderColor: active ? '#8FDCC0' : '#DCE8F7',
        backgroundColor: active ? '#DFF5EC' : '#FFFFFF',
        paddingHorizontal: 13,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <AppText
        className="text-[11px] leading-4"
        style={{ color: active ? '#178A52' : '#5B6B82', fontFamily: 'Manrope_700Bold' }}
      >
        {label}
      </AppText>
      <View
        style={{
          marginLeft: 6,
          minWidth: 20,
          borderRadius: 999,
          paddingHorizontal: 6,
          paddingVertical: 2,
          backgroundColor: active ? '#C5EEDF' : '#F1F5FB',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppText
          className="text-[10px] leading-[13px]"
          style={{ color: active ? '#178A52' : '#8A98AC', fontFamily: 'Manrope_700Bold' }}
        >
          {count}
        </AppText>
      </View>
    </Pressable>
  );
}

// ─── Product card (no product image, per design) ───────────────────────────

function ProductCard({
  product,
  onPress,
}: {
  product: Product;
  onPress: () => void;
}) {
  const status = stockStatusOf(product);
  const category = product.grade || product.physical_state || 'Chemical';
  const quantity = quantityOf(product);
  const price = priceOf(product);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${product.name}`}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#DCE8F7',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 16,
        paddingVertical: 14,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* Name, category, price */}
        <View style={{ flex: 1, marginRight: 10 }}>
          <AppText
            className="text-[15px] leading-[21px] text-navy"
            numberOfLines={1}
            style={{ fontFamily: 'Manrope_800ExtraBold' }}
          >
            {product.name}
          </AppText>

          <AppText variant="tiny" className="mt-[3px] text-[10px] leading-[15px]">
            {category} • {formatQuantity(quantity)} kg
          </AppText>

          <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'baseline' }}>
            <AppText
              className="text-[15px] text-navy"
              style={{ fontFamily: 'Manrope_800ExtraBold' }}
            >
              ₹ {price.toLocaleString('en-IN')}
            </AppText>
            <AppText variant="tiny" className="text-[10px]" style={{ marginLeft: 2 }}>
              {' '}
              / kg
            </AppText>
          </View>
        </View>

        {/* Status badge + stock amount */}
        <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
          <StockBadge status={status} />
          <AppText variant="tiny" className="mt-2 text-[11px] text-muted">
            {status === 'out' ? '0 kg' : `${formatQuantity(quantity)} kg`}
          </AppText>
        </View>

        {/* Chevron */}
        <View style={{ marginLeft: 10 }}>
          <ChevronRight size={18} color="#8A98AC" strokeWidth={2.1} />
        </View>
      </View>
    </Pressable>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');

  const router = useRouter();

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result = await apiRequest<Product[]>('/products');
      setProducts(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load products.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // This async loader updates state after the API request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProducts();
  }, [loadProducts]);

  const openAddForm = () => {
    setEditingProduct(null);
    setFormOpen(true);
  };

  const openEditForm = (product: Product) => {
    setEditingProduct(product);
    setFormOpen(true);
  };

  /** From the details view: close details first so the form sits on a fresh layer. */
  const openEditFromDetails = () => {
    if (!viewingProduct) return;

    openEditForm(viewingProduct);
    setViewingProduct(null);
  };

  const deleteFromDetails = () => {
    if (!viewingProduct) return;

    const product = viewingProduct;
    setViewingProduct(null);
    confirmDelete(product);
  };

  const saveProduct = async (values: Record<string, string>) => {
    setSaving(true);
    setError('');

    try {
      const payload = toPayload(values);

      if (editingProduct) {
        await apiRequest(`/products/${encodeURIComponent(editingProduct.id)}`, {
          method: 'PUT',
          body: payload,
        });
      } else {
        await apiRequest('/products', {
          method: 'POST',
          body: payload,
        });
      }

      setFormOpen(false);
      setEditingProduct(null);
      await loadProducts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save product.';

      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Save failed', message);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (product: Product) => {
    try {
      await apiRequest(`/products/${encodeURIComponent(product.id)}`, {
        method: 'DELETE',
      });
      await loadProducts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to delete product.';

      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Delete failed', message);
      }
    }
  };

  const confirmDelete = (product: Product) => {
    const message =
      `Delete "${product.name}" (${product.sku})?\n\n` +
      'This may also permanently delete associated batches, QC records, dispatch records and QR labels.';

    if (Platform.OS === 'web') {
      if (window.confirm(message)) void deleteProduct(product);
      return;
    }

    Alert.alert('Delete product?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteProduct(product),
      },
    ]);
  };

  const counts = useMemo(() => {
    let inStock = 0;
    let lowStock = 0;
    let outStock = 0;

    for (const product of products) {
      switch (stockStatusOf(product)) {
        case 'in':
          inStock += 1;
          break;
        case 'low':
          lowStock += 1;
          break;
        default:
          outStock += 1;
      }
    }

    return { all: products.length, in: inStock, low: lowStock, out: outStock } satisfies Record<StockFilter, number>;
  }, [products]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      if (filter !== 'all' && stockStatusOf(product) !== filter) return false;

      if (!query) return true;

      return (
        product.name?.toLowerCase().includes(query) ||
        product.sku?.toLowerCase().includes(query) ||
        product.description?.toLowerCase().includes(query)
      );
    });
  }, [products, search, filter]);

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 118 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void loadProducts()} />
        }
      >
        <View className="px-5 pt-5">
          {/* Heading + refresh */}
          <View className="flex-row items-start justify-between">
            <BackHeading
              title="Products"
              subtitle="Manage your product inventory"
              onBack={() => void router.back()}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh products"
              onPress={() => void loadProducts()}
              disabled={loading}
              className="mt-1 h-10 w-10 items-center justify-center rounded-full border border-line bg-canvas-alt"
              style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
            >
              <RefreshCw size={17} color={colors.navy} strokeWidth={1.9} />
            </Pressable>
          </View>

          {/* Search */}
          <View className="mt-5 flex-row items-center rounded-full border border-line bg-white px-4 py-3">
            <Search size={18} color="#8A98AC" strokeWidth={2} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search products..."
              placeholderTextColor="#94A3B8"
              returnKeyType="search"
              accessibilityLabel="Search products"
              className="flex-1 text-[13px] text-navy"
              style={{
                fontFamily: 'Manrope_500Medium',
                paddingVertical: 0,
                marginLeft: 10,
              }}
            />
          </View>

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-4"
            style={{ flexGrow: 0 }}
          >
            <View className="flex-row">
              {filterOptions.map((option, index) => (
                <View
                  key={option.key}
                  style={{ marginLeft: index === 0 ? 0 : 8 }}
                >
                  <FilterChip
                    label={option.label}
                    count={counts[option.key]}
                    active={filter === option.key}
                    onPress={() => setFilter(option.key)}
                  />
                </View>
              ))}
            </View>
          </ScrollView>

          {error ? (
            <View className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <AppText className="text-[13px] text-red-700">{error}</AppText>
              <Pressable onPress={() => void loadProducts()} className="mt-2">
                <AppText className="text-[13px] text-navy">Try again</AppText>
              </Pressable>
            </View>
          ) : null}

          {loading ? (
            <View className="mt-8 items-center py-10">
              <AppText variant="caption">Loading products...</AppText>
            </View>
          ) : products.length === 0 && !error ? (
            <View className="mt-6 items-center rounded-2xl border border-line bg-white px-6 py-10">
              <IconTile icon={Package} size={24} className="bg-emerald-50" />
              <AppText
                className="mt-4 text-[15px] text-navy"
                style={{ fontFamily: 'Manrope_700Bold' }}
              >
                No products yet
              </AppText>
              <AppText variant="caption" className="mt-1 text-center">
                Add your first product to start managing inventory.
              </AppText>
            </View>
          ) : visibleProducts.length === 0 ? (
            <View className="mt-6 items-center rounded-2xl border border-line bg-white px-6 py-10">
              <IconTile icon={Search} size={24} className="bg-slate-100" />
              <AppText
                className="mt-4 text-[15px] text-navy"
                style={{ fontFamily: 'Manrope_700Bold' }}
              >
                No matches found
              </AppText>
              <AppText variant="caption" className="mt-1 text-center">
                Try a different search or filter combination.
              </AppText>
            </View>
          ) : (
            <View className="mt-5">
              {visibleProducts.map((product, index) => (
                <View key={product.id} style={{ marginTop: index === 0 ? 0 : 12 }}>
                  <ProductCard product={product} onPress={() => setViewingProduct(product)} />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating add button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add product"
        onPress={openAddForm}
        className="absolute bottom-6 right-5 z-10 h-14 w-14 items-center justify-center rounded-full"
        style={({ pressed }) => [
          {
            backgroundColor: '#10A37F',
            shadowColor: '#10A37F',
            shadowOpacity: 0.35,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 6,
          },
          pressed ? { opacity: 0.85 } : undefined,
        ]}
      >
        <Plus size={26} color="#FFFFFF" strokeWidth={2.4} />
      </Pressable>

      {viewingProduct ? (
        <ProductDetails
          product={viewingProduct}
          onClose={() => setViewingProduct(null)}
          onEdit={openEditFromDetails}
          onDelete={deleteFromDetails}
        />
      ) : null}

      <ProductForm
        key={`${formOpen ? 'open' : 'closed'}-${editingProduct?.id ?? 'new'}`}
        visible={formOpen}
        product={editingProduct}
        saving={saving}
        onClose={() => {
          if (!saving) {
            setFormOpen(false);
            setEditingProduct(null);
          }
        }}
        onSave={(values) => {
          if (!saving) void saveProduct(values);
        }}
      />
    </Screen>
  );
}
