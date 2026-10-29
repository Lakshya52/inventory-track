import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { Package, Plus, Search } from 'lucide-react-native';

import { AppText } from '@/components/ui/app-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { PrimaryButton } from '@/components/ui/buttons';
import { Field } from '@/components/ui/field';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRole } from '@/context/role-context';
import { apiRequest } from '@/services/api';
import { batchApi, type BatchRecord } from '@/services/batches';

type ProductOption = { id: string | number; name: string; sku?: string; is_active?: number | boolean };

export function BatchesScreen() {
  const { user } = useRole();
  const canCreate = user?.role === 'qc';
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [uom, setUom] = useState('pcs');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [batchRows, productRows] = await Promise.all([
        batchApi.list(),
        apiRequest<ProductOption[]>('/products'),
      ]);
      setBatches(batchRows);
      setProducts(productRows.filter((product) => product.is_active == null || product.is_active === true || Number(product.is_active) === 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load batches.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Load current inventory and eligible products when the screen opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((batch) => [batch.batch_number, batch.product_name, batch.product_sku, batch.status].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [batches, query]);

  const openCreate = () => {
    setProductId('');
    setBatchNumber('');
    setQuantity('1');
    setUom('pcs');
    setCreateOpen(true);
  };

  const createBatch = async () => {
    const count = Number(quantity);
    if (!productId) {
      Alert.alert('Select a product', 'Choose the product for this QC batch.');
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      Alert.alert('Check quantity', 'Enter a whole number from 1 to 1,000.');
      return;
    }
    setSaving(true);
    try {
      const result = await batchApi.create({ product_id: productId, quantity: count, batch_count: 1, uom: uom.trim() || 'pcs', ...(batchNumber.trim() ? { batch_number: batchNumber.trim() } : {}) });
      setCreateOpen(false);
      await load(true);
      Alert.alert('Batch created', `${result.batches[0]?.batch_number || 'Batch'} was created as QC passed and ${count} QR labels are ready.`);
    } catch (err) {
      Alert.alert('Could not create batch', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} colors={["#011A87"]} />} showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-6">
          <View className="flex-row items-start justify-between gap-3">
            <PageHeading title="Batches" subtitle={canCreate ? 'Create QC-passed batches and review inventory' : 'Review batch inventory and QC status'} />
            {canCreate ? <Pressable accessibilityRole="button" onPress={openCreate} className="mt-1 h-11 w-11 items-center justify-center rounded-xl bg-navy"><Plus size={21} color="#FFFFFF" /></Pressable> : null}
          </View>
          {canCreate ? <PrimaryButton label="Create Batch" icon={Plus} size="md" className="mt-4" onPress={openCreate} /> : null}
          <View className="mt-4 flex-row items-center gap-2 rounded-xl border border-line bg-white px-3">
            <Search size={17} color="#75839A" />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search batch, product, SKU" className="h-11 flex-1 text-[13px] text-navy" />
          </View>
          {error ? <AppText className="mt-3 rounded-xl bg-[#FFF2F3] p-3 text-[12px] text-[#B42332]">{error}</AppText> : null}
          {loading ? <View className="mt-8 items-center"><ActivityIndicator color="#011A87" /><AppText className="mt-2 text-[12px] text-[#68758A]">Loading batches…</AppText></View> : null}
          {!loading && !error && filtered.length === 0 ? <View className="mt-5 items-center rounded-2xl border border-dashed border-[#C7D6EA] bg-white px-5 py-8"><Package size={24} color="#011A87" /><AppText className="mt-2 text-[13px] font-manrope-bold text-navy">No batches found</AppText><AppText className="mt-1 text-center text-[11px] leading-4 text-[#68758A]">{query ? 'Try another batch number or product.' : 'Created batches will show up here.'}</AppText></View> : null}
          <View className="mt-4 gap-3">
            {filtered.map((batch) => (
              <View key={String(batch.id)} className="rounded-2xl border border-[#D4E3FA] bg-white p-4">
                <View className="flex-row items-start gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#EBF3FF]"><Package size={19} color="#011A87" /></View>
                  <View className="min-w-0 flex-1">
                    <AppText className="text-[14px] font-manrope-extrabold text-navy" numberOfLines={1}>{batch.batch_number}</AppText>
                    <AppText className="mt-1 text-[12px] text-[#27364D]" numberOfLines={1}>{batch.product_name || 'Product'}{batch.product_sku ? ` · ${batch.product_sku}` : ''}</AppText>
                  </View>
                  <StatusBadge status={batch.status} label={batch.status.replaceAll('_', ' ')} className="shrink-0" />
                </View>
                <View className="mt-3 flex-row flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3">
                  <AppText className="text-[11px] text-[#5B6980]">Qty: {batch.quantity} {batch.uom || 'pcs'}</AppText>
                  <AppText className="text-[11px] text-[#5B6980]">QR labels: {batch.qr_count ?? '—'}</AppText>
                  {batch.location_code || batch.storage_location ? <AppText className="text-[11px] text-[#5B6980]">Location: {batch.location_code || batch.storage_location}</AppText> : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <BottomSheet visible={createOpen} onClose={() => { if (!saving) setCreateOpen(false); }} title="Create QC Batch">
        <View>
          <AppText className="mb-2 text-[11px] font-manrope-bold text-navy">Select product</AppText>
          <View className="max-h-[180px] gap-2">
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
              {products.map((product) => {
                const active = String(product.id) === productId;
                return <Pressable key={String(product.id)} onPress={() => setProductId(String(product.id))} className={`mb-2 rounded-xl border px-3 py-2.5 ${active ? 'border-navy bg-[#EBF3FF]' : 'border-line bg-white'}`}><AppText className="text-[12px] font-manrope-bold text-navy">{product.name}</AppText><AppText className="mt-0.5 text-[10px] text-[#68758A]">{product.sku || 'No SKU'}</AppText></Pressable>;
              })}
            </ScrollView>
          </View>
          <Field label="Batch number (optional)" value={batchNumber} onChangeText={setBatchNumber} placeholder="Leave blank to generate" />
          <View className="flex-row gap-3">
            <View className="flex-1"><Field label="Unit quantity" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" placeholder="1" /></View>
            <View className="flex-1"><Field label="Unit" value={uom} onChangeText={setUom} placeholder="pcs" /></View>
          </View>
          <AppText className="mb-3 mt-1 text-[10px] leading-4 text-[#68758A]">New batches are marked QC passed automatically and their QR labels are generated by the system.</AppText>
          <PrimaryButton label={saving ? 'Creating…' : 'Create Batch'} icon={Plus} disabled={saving} onPress={() => void createBatch()} />
        </View>
      </BottomSheet>
    </Screen>
  );
}
