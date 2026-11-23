import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Check, Plus, Search } from 'lucide-react-native';

import { ScreenTitle, SectionHeading } from '@/components/common/Primitives';
import { useAppData } from '@/contexts/AppDataContext';
import { useBatchCreation } from '@/contexts/BatchCreationContext';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { domainApi } from '@/services/domain';
import type { Product } from '@/types/domain';
import { WorkflowShell } from './WorkflowShell';
import { BatchStepper } from './BatchStepper';
import { StepActions } from './StepActions';

export function CreateBatchSelect() {
  const { products, refresh } = useAppData();
  const { items, addProduct, removeProduct } = useBatchCreation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const { refreshing, refresh: onRefresh } = usePullRefresh(refresh);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      domainApi
        .searchProducts(query.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const list = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return products;

    const terms = normalized.split(/\s+/).filter(Boolean);
    const localMatches = products.filter((product) => {
      const haystack = [product.name, product.grade, product.sku, product.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });

    // The backend search only looks at name/SKU, so merge its results with the
    // local name/grade/SKU matches (de-duplicated by id).
    const seen = new Set<string>();
    const merged: Product[] = [];
    for (const product of [...localMatches, ...results]) {
      const key = String(product.id);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(product);
    }
    return merged;
  }, [products, query, results]);

  // Grades belong to a product family, so group the list by the product name
  // (e.g. XLPE COMPOUND, TPR COMPOUND) and list its grades underneath.
  const grouped = useMemo(() => {
    const groups = new Map<string, Product[]>();
    for (const product of list) {
      const name = product.name?.trim() || 'Other';
      const existing = groups.get(name);
      if (existing) existing.push(product);
      else groups.set(name, [product]);
    }
    return Array.from(groups, ([name, grades]) => ({ name, grades }));
  }, [list]);

  const isSelected = (id: string | number) => items.some((item) => item.product.id === id);

  return (
    <WorkflowShell refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenTitle>Create a Stock Batch</ScreenTitle>
      <BatchStepper active={1} />

      <View className="mt-7">
        <SectionHeading>Select Products To Add</SectionHeading>
      </View>

      <View className="mt-3 flex-row gap-2">
        <View className="flex-1">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Products"
            className="h-12 rounded-xl bg-[#eef1f7] px-4 font-lexend text-ink"
          />
        </View>
        <View className="h-12 w-12 items-center justify-center rounded-xl bg-[#7b86c4]">
          <Search size={20} color="#ffffff" />
        </View>
      </View>
      {searching && list.length === 0 ? <ActivityIndicator className="mt-2" color="#0b218c" /> : null}

      <View className="mt-4 overflow-hidden rounded-2xl border border-[#e6e9f2] bg-canvas">
        {grouped.map((group) => (
          <View key={group.name}>
            <View className="flex-row items-center justify-between border-b border-[#e6e9f2] bg-[#f7f8fc] px-4 py-2">
              <Text className="text-[11px] font-lexend-bold uppercase text-brand">{group.name}</Text>
              <Text className="text-[10px] font-lexend text-muted">{group.grades.length}</Text>
            </View>
            {group.grades.map((product, index) => {
              const selected = isSelected(product.id);
              return (
                <Pressable
                  key={product.id}
                  onPress={() => (selected ? removeProduct(product.id) : addProduct(product))}
                  className={`flex-row items-center justify-between px-4 py-3 ${
                    index !== group.grades.length - 1 ? 'border-b border-[#e6e9f2]' : ''
                  } ${selected ? 'bg-[#eef8f4]' : ''}`}>
                  <View className="flex-1">
                    <Text className="text-sm font-lexend-semibold text-ink">{product.grade || product.name}</Text>
                    <View className="mt-1 flex-row items-center gap-2">
                      <View className="rounded bg-[#0ba178] px-1.5 py-0.5">
                        <Text className="text-[8px] font-lexend-semibold text-white">{product.name}</Text>
                      </View>
                      <Text className="text-[10px] font-lexend text-muted">SKU : {product.sku}</Text>
                    </View>
                  </View>
                  <View
                    className={`h-8 w-8 items-center justify-center rounded-lg border ${
                      selected ? 'border-[#0ba178] bg-[#0ba178]' : 'border-[#dfe3ee]'
                    }`}>
                    {selected ? <Check size={18} color="#ffffff" /> : <Plus size={18} color="#14204b" />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        {list.length === 0 && !searching ? (
          <Text className="px-4 py-6 text-center text-sm text-muted">
            {query.trim() ? `No grades match “${query.trim()}”.` : 'No products available.'}
          </Text>
        ) : null}
      </View>

      <StepActions
        onPrevious={() => router.back()}
        onNext={() => router.push('/batches/create/quantity')}
        nextDisabled={items.length === 0}
      />
    </WorkflowShell>
  );
}
