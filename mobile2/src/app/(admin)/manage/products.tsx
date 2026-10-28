
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  View,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Package,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  X,
} from 'lucide-react-native';

import { AppText } from '@/components/ui/app-text';
import { IconTile, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
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
    <View className="mb-4">
      <AppText
        className="mb-2 text-[14px] text-navy"
        style={{ fontFamily: 'Manrope_700Bold' }}
      >
        {field.label}
      </AppText>

      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={field.placeholder}
        placeholderTextColor="#94A3B8"
        keyboardType={field.numeric ? 'decimal-pad' : 'default'}
        multiline={field.multiline}
        textAlignVertical={field.multiline ? 'top' : 'center'}
        accessibilityLabel={field.label}
        className="rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-navy"
        style={{
          minHeight: field.multiline ? 94 : 54,
          paddingTop: field.multiline ? 14 : 0,
          paddingBottom: field.multiline ? 14 : 0,
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
  const [values, setValues] = useState<Record<string, string>>(emptyValues);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (visible) {
      setValues(toFormValues(product ?? undefined));
      setFormError('');
    }
  }, [visible, product]);

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
    <View className="absolute inset-0 z-50 bg-[#F5F7FA]">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <View className="flex-1 pr-3">
            <AppText
              className="text-[22px] text-navy"
              style={{ fontFamily: 'Manrope_700Bold' }}
            >
              {product ? 'Edit Product' : 'Add Product'}
            </AppText>
            <AppText variant="caption" className="mt-1">
              Enter the product details below
            </AppText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close product form"
            disabled={saving}
            onPress={onClose}
            className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
          >
            <X size={20} color={colors.navy} />
          </Pressable>
        </View>

        {/* Scrollable single-page form */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 28,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {sections.map((section, index) => (
            <View
              key={section.title}
              className="mb-4 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <View className="mb-4 flex-row items-center">
                <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl bg-emerald-50">
                  <AppText
                    className="text-[14px] text-emerald-700"
                    style={{ fontFamily: 'Manrope_700Bold' }}
                  >
                    {index + 1}
                  </AppText>
                </View>

                <AppText
                  className="text-[16px] text-navy"
                  style={{ fontFamily: 'Manrope_700Bold' }}
                >
                  {section.title}
                </AppText>
              </View>

              {section.title === 'Stock & Pricing' ? (
                <>
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      {renderField(section.fields[0])}
                    </View>
                    <View className="flex-1">
                      {renderField(section.fields[1])}
                    </View>
                  </View>
                  {renderField(section.fields[2])}
                </>
              ) : section.title === 'Chemical Specifications' ? (
                <>
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      {renderField(section.fields[0])}
                    </View>
                    <View className="flex-1">
                      {renderField(section.fields[1])}
                    </View>
                  </View>
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      {renderField(section.fields[2])}
                    </View>
                    <View className="flex-1">
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
            <View className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
              <AppText className="text-[14px] text-red-700">
                {formError}
              </AppText>
            </View>
          ) : null}
        </ScrollView>

        {/* Fixed save action */}
        <View className="border-t border-slate-200 bg-white px-5 pb-5 pt-3">
          {/* secondary button here  */}
          <SecondaryButton
            label="Cancel"
            variant="outline"
            className="h-[54px] rounded-full mb-5"
            labelClassName="text-[16px]"
            onPress={onClose}
          />
          {/* {formError ? (
            <View className="mb-2 rounded-xl border border-red-200 bg-red-50 p-3">
              <AppText className="text-[14px] text-red-700">
                {formError}
              </AppText>
            </View>
          ) : null} */}
          <PrimaryButton
            label={
              saving
                ? 'Saving...'
                : product
                  ? 'Save Changes'
                  : 'Add Product'
            }
            className="h-[54px] rounded-full"
            labelClassName="text-[16px]"
            onPress={handleSave}
          />
          <AppText variant="caption" className="mt-2 text-center">
            * Required fields
          </AppText>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export default function ProductsScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

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

  const router = useRouter();

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5 pt-5">
          <BackHeading
            title="Product Management"
            subtitle="Manage your factory products"
            onBack={() => void router.back()}
          />

          <PrimaryButton
            label="Add Product"
            icon={Plus}
            className="mt-6 h-[50px] rounded-full"
            labelClassName="text-[16px]"
            onPress={openAddForm}
          />

          <View className="mt-8 flex-row items-center justify-between">
            <View>
              <AppText
                className="text-[18px] text-navy"
                style={{ fontFamily: 'Manrope_700Bold' }}
              >
                Products
              </AppText>
              <AppText variant="caption" className="mt-1">
                {products.length} {products.length === 1 ? 'product' : 'products'} in database
              </AppText>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh products"
              onPress={() => void loadProducts()}
              disabled={loading}
              className="h-10 w-10 items-center justify-center rounded-full border border-line bg-white"
            >
              <RefreshCw size={17} color={colors.navy} />
            </Pressable>
          </View>

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
          ) : (
            <View className="mt-5 gap-3">
              {products.map((product) => (
                <View
                  key={product.id}
                  className="rounded-2xl border border-line bg-white p-4"
                >
                  <View className="flex-row items-start gap-3">
                    <IconTile icon={Package} className="bg-emerald-50" size={20} />

                    <View className="flex-1">
                      <AppText
                        className="text-[14px] text-navy"
                        style={{ fontFamily: 'Manrope_700Bold' }}
                      >
                        {product.name}
                      </AppText>
                      <AppText variant="caption" className="mt-1">
                        SKU: {product.sku}
                      </AppText>

                      <View className="mt-3 flex-row flex-wrap gap-2">
                        <View className="rounded-lg bg-cyan-50 px-3 py-1.5">
                          <AppText className="text-[12px] text-navy">
                            Qty: {product.quantity ?? 0}
                          </AppText>
                        </View>

                        {product.grade ? (
                          <View className="rounded-lg bg-slate-100 px-3 py-1.5">
                            <AppText className="text-[12px] text-navy">
                              {product.grade}
                            </AppText>
                          </View>
                        ) : null}

                        {product.price != null ? (
                          <View className="rounded-lg bg-slate-100 px-3 py-1.5">
                            <AppText className="text-[12px] text-navy">
                              Price: {product.price}
                            </AppText>
                          </View>
                        ) : null}
                      </View>

                      {product.description ? (
                        <AppText variant="caption" className="mt-2">
                          {product.description}
                        </AppText>
                      ) : null}
                    </View>
                  </View>

                  <View className="mt-4 flex-row justify-end gap-2 border-t border-line pt-3">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${product.name}`}
                      onPress={() => openEditForm(product)}
                      className="flex-row items-center gap-2 rounded-full border border-line px-4 py-2.5"
                    >
                      <Pencil size={15} color={colors.navy} />
                      <AppText className="text-[12px] text-navy">Edit</AppText>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${product.name}`}
                      onPress={() => confirmDelete(product)}
                      className="flex-row items-center gap-2 rounded-full border border-red-200 px-4 py-2.5"
                    >
                      <Trash2 size={15} color="#DC2626" />
                      <AppText className="text-[12px] text-red-600">Delete</AppText>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <ProductForm
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
