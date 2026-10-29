import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { AlertCircle, CheckCircle2, ClipboardList, History, Search, Truck, X } from 'lucide-react-native';

import { AppText } from '@/components/ui/app-text';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { dispatchApi, type DispatchHistoryRecord } from '@/services/dispatch';
import type { DispatchOrder } from '@/types';

type HistoryFilter = 'ALL' | 'ORDERS' | 'DISPATCHED' | 'EXCEPTIONS';

type HistoryItem = {
  id: string;
  kind: 'ORDER' | 'DISPATCH';
  title: string;
  status: string;
  date?: string | null;
  orderId?: string | null;
  batch?: string | null;
  product?: string | null;
  client?: string | null;
  vehicle?: string | null;
  seal?: string | null;
  remarks?: string | null;
};

const PAGE_SIZE = 30;

function formatDate(value?: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function orderLabel(status: string): string {
  switch (status) {
    case 'PENDING': return 'Waiting for QC';
    case 'APPROVED':
    case 'DISPATCH_APPROVED': return 'Approved for loading';
    case 'REJECTED': return 'Rejected by QC';
    case 'CLOSED_DISPATCHED':
    case 'DISPATCHED': return 'Request completed';
    case 'CLOSED_NOT_DISPATCHED':
    case 'NOT_DISPATCHED': return 'Not dispatched';
    default: return status.replaceAll('_', ' ').toLowerCase();
  }
}

function buildItems(orders: DispatchOrder[], records: DispatchHistoryRecord[]): HistoryItem[] {
  const orderById = new Map(orders.map((order) => [String(order.id), order]));
  const orderItems: HistoryItem[] = orders.map((order) => {
    const status = String(order.status || 'PENDING').toUpperCase();
    return {
      id: `order-${order.id}`,
      kind: 'ORDER',
      title: 'Dispatch request raised',
      status,
      date: order.created_at,
      orderId: String(order.id),
      batch: order.batch_number,
      product: order.product_name,
      client: order.client_name,
      vehicle: order.vehicle_number,
      seal: order.seal_number,
      remarks: status === 'REJECTED' ? order.remarks || order.admin_remarks : undefined,
    };
  });

  const dispatchItems: HistoryItem[] = records.map((record, index) => {
    const order = record.dispatch_order_id
      ? orderById.get(String(record.dispatch_order_id))
      : undefined;
    const dispatched = record.dispatched === true || Number(record.dispatched) === 1;
    const status = dispatched ? 'CLOSED_DISPATCHED' : 'CLOSED_NOT_DISPATCHED';
    return {
      id: `dispatch-${record.id || record.session_id || `${record.dispatch_order_id || 'record'}-${index}`}`,
      kind: 'DISPATCH',
      title: dispatched ? 'Dispatch completed' : 'Dispatch closed without dispatch',
      status,
      date: record.created_at,
      orderId: record.dispatch_order_id ? String(record.dispatch_order_id) : null,
      batch: record.batch_number,
      product: record.product_name,
      client: order?.client_name,
      vehicle: order?.vehicle_number,
      seal: order?.seal_number,
      remarks: record.remarks || order?.remarks,
    };
  });

  return [...orderItems, ...dispatchItems].sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : 0;
    const dateB = b.date ? new Date(b.date).getTime() : 0;
    return dateB - dateA;
  });
}

export function DispatchHistoryScreen() {
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [records, setRecords] = useState<DispatchHistoryRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const loadHistory = useCallback(async (showRefresh = false) => {
    const currentRequest = ++requestId.current;
    setError('');
    if (showRefresh) setRefreshing(true);
    try {
      const [ordersResult, historyResult] = await Promise.allSettled([
        dispatchApi.myOrders({ q: search.trim() || undefined }),
        dispatchApi.history({ page: 1, limit: PAGE_SIZE, q: search.trim() || undefined }),
      ]);
      if (currentRequest !== requestId.current) return;
      const failures: string[] = [];
      if (ordersResult.status === 'fulfilled') setOrders(ordersResult.value || []);
      else failures.push(ordersResult.reason?.message || 'Could not load dispatch requests.');
      if (historyResult.status === 'fulfilled') {
        setRecords(historyResult.value.items || []);
        setTotalRecords(Number(historyResult.value.total || 0));
        setPage(1);
      } else failures.push(historyResult.reason?.message || 'Could not load dispatch activity.');
      setError(failures.join(' '));
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => { void loadHistory(); }, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [loadHistory, search]);

  const loadMore = async () => {
    if (loadingMore || records.length >= totalRecords) return;
    const currentRequest = requestId.current;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const result = await dispatchApi.history({ page: nextPage, limit: PAGE_SIZE, q: search.trim() || undefined });
      if (currentRequest !== requestId.current) return;
      setRecords((current) => {
        const known = new Set(current.map((record) => String(record.id || record.session_id || `${record.dispatch_order_id}-${record.created_at}`)));
        const additional = (result.items || []).filter((record) => {
          const key = String(record.id || record.session_id || `${record.dispatch_order_id}-${record.created_at}`);
          return !known.has(key);
        });
        return [...current, ...additional];
      });
      setPage(nextPage);
      setTotalRecords(Number(result.total || 0));
    } catch (err: any) {
      if (currentRequest === requestId.current) setError(err?.message || 'Could not load more dispatch history.');
    } finally {
      setLoadingMore(false);
    }
  };

  const allItems = useMemo(() => buildItems(orders, records), [orders, records]);
  const visibleItems = useMemo(() => allItems.filter((item) => {
    if (filter === 'ORDERS') return item.kind === 'ORDER';
    if (filter === 'DISPATCHED') return item.kind === 'DISPATCH' && item.status === 'CLOSED_DISPATCHED';
    if (filter === 'EXCEPTIONS') return item.status === 'REJECTED' || item.status === 'CLOSED_NOT_DISPATCHED';
    return true;
  }), [allItems, filter]);

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadHistory(true)} colors={['#011A87']} />}>
        <View className="px-5 pt-6">
          <PageHeading title="Dispatch History" subtitle="Your dispatch requests and completed loading records" />

          <View className="mt-5 flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-[#D9E6F7] bg-white p-4">
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#EEF4FF]"><History size={17} color="#011A87" /></View>
              <AppText className="mt-3 text-[22px] font-manrope-extrabold text-navy">{orders.length}</AppText>
              <AppText variant="caption" className="mt-0.5 text-[11px]">Order requests</AppText>
            </View>
            <View className="flex-1 rounded-2xl border border-[#C8EBD7] bg-[#F5FCF8] p-4">
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#E4F7EC]"><CheckCircle2 size={17} color="#13824A" /></View>
              <AppText className="mt-3 text-[22px] font-manrope-extrabold text-[#126B3C]">{totalRecords}</AppText>
              <AppText variant="caption" className="mt-0.5 text-[11px]">Loading records</AppText>
            </View>
          </View>

          <View className="mt-5 flex-row items-center rounded-xl border border-line bg-white px-3.5 py-2">
            <Search size={16} color="#8A98AC" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search order, batch, client, product..."
              placeholderTextColor="#8A98AC"
              returnKeyType="search"
              className="ml-2 flex-1 font-manrope-medium text-[13px] text-navy" />
            {search.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')}><X size={15} color="#8A98AC" /></Pressable> : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3.5 -mx-5 px-5" contentContainerStyle={{ gap: 8 }}>
            {([
              { id: 'ALL', label: 'All Activity' },
              { id: 'ORDERS', label: 'Requests' },
              { id: 'DISPATCHED', label: 'Completed' },
              { id: 'EXCEPTIONS', label: 'Needs Attention' },
            ] as const).map((chip) => {
              const active = filter === chip.id;
              return (
                <Pressable key={chip.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setFilter(chip.id)} className={`rounded-full border px-3.5 py-2 ${active ? 'border-navy bg-navy' : 'border-[#D4E3FA] bg-white'}`}>
                  <AppText className={`text-[11.5px] ${active ? 'font-manrope-bold text-white' : 'font-manrope-medium text-[#4E5D76]'}`}>{chip.label}</AppText>
                </Pressable>
              );
            })}
          </ScrollView>

          {error ? (
            <View className="mt-4 flex-row items-center gap-2 rounded-xl border border-[#F5C2C7] bg-[#FFF5F5] p-3">
              <AlertCircle size={16} color="#B42332" />
              <AppText className="flex-1 text-[11px] text-[#9E202C]">{error}</AppText>
              <Pressable onPress={() => void loadHistory(true)}><AppText className="text-[11px] font-manrope-bold text-navy">Retry</AppText></Pressable>
            </View>
          ) : null}

          <View className="mt-5 flex-row items-center justify-between">
            <AppText variant="label" className="text-[12px]">Activity timeline</AppText>
            <AppText variant="caption" className="text-[10px]">Newest first</AppText>
          </View>

          <View className="mt-3 gap-3">
            {loading ? (
              <View className="items-center rounded-2xl border border-line bg-white py-10"><ActivityIndicator color="#011A87" /><AppText variant="caption" className="mt-2">Loading your history…</AppText></View>
            ) : visibleItems.length === 0 ? (
              <View className="items-center rounded-2xl border border-dashed border-[#CCD7E6] bg-white px-6 py-10">
                <ClipboardList size={32} color="#8A98AC" strokeWidth={1.6} />
                <AppText variant="h3" className="mt-3">No activity found</AppText>
                <AppText variant="caption" className="mt-1 text-center text-[11px]">{search ? 'Try another order, batch, product, or client.' : 'Dispatch requests and completed loading records will appear here.'}</AppText>
              </View>
            ) : visibleItems.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </View>

          {!loading && records.length < totalRecords ? (
            <Pressable accessibilityRole="button" onPress={() => void loadMore()} disabled={loadingMore} className="mt-4 h-11 flex-row items-center justify-center gap-2 rounded-xl border border-[#C9D8EF] bg-white">
              {loadingMore ? <ActivityIndicator size="small" color="#011A87" /> : <Truck size={15} color="#011A87" />}
              <AppText className="text-[12px] font-manrope-bold text-navy">{loadingMore ? 'Loading…' : `Load more completed records (${records.length} of ${totalRecords})`}</AppText>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function HistoryCard({ item }: { item: HistoryItem }) {
  const isDispatch = item.kind === 'DISPATCH';
  const isException = item.status === 'REJECTED' || item.status === 'CLOSED_NOT_DISPATCHED';
  return (
    <View className="flex-row gap-3 rounded-2xl border border-[#DCE6F2] bg-white p-4">
      <View className={`mt-0.5 h-9 w-9 items-center justify-center rounded-xl ${isException ? 'bg-[#FFF0F0]' : isDispatch ? 'bg-[#EAF8F0]' : 'bg-[#EEF4FF]'}`}>
        {isException ? <AlertCircle size={17} color="#C02A38" /> : isDispatch ? <CheckCircle2 size={17} color="#13824A" /> : <ClipboardList size={17} color="#011A87" />}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1">
            <AppText className="text-[13px] font-manrope-bold text-navy">{item.title}</AppText>
            <AppText variant="caption" className="mt-0.5 text-[10px]">{formatDate(item.date)}</AppText>
          </View>
          <StatusBadge status={item.status} label={isDispatch ? (item.status === 'CLOSED_DISPATCHED' ? 'Dispatched' : 'Not dispatched') : orderLabel(item.status)} />
        </View>
        <AppText className="mt-2 text-[11.5px] font-manrope-semibold text-[#293A54]" numberOfLines={2}>
          {item.product || 'Dispatch order'}{item.batch ? ` · Batch ${item.batch}` : ''}
        </AppText>
        <AppText variant="caption" className="mt-0.5 text-[10.5px]" numberOfLines={2}>
          {item.orderId ? `Order #${item.orderId}` : 'Order'}{item.client ? ` · ${item.client}` : ''}{item.vehicle ? ` · ${item.vehicle}` : ''}
        </AppText>
        {item.seal ? <AppText variant="caption" className="mt-1 text-[10px] text-[#126B3C]">Seal {item.seal}</AppText> : null}
        {item.remarks ? <AppText variant="caption" className={`mt-1 text-[10px] ${isException ? 'text-[#9E202C]' : ''}`} numberOfLines={3}>Note: {item.remarks}</AppText> : null}
      </View>
    </View>
  );
}
