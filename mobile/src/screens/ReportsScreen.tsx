import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, EmptyState, Field, LoadingView, Screen, SectionHeader } from '../components/ui';
import { colors, spacing } from '../theme';
import LimitedAccessScreen from './LimitedAccessScreen';

const kinds = [
  { key: 'summary', label: 'Overview' }, { key: 'qc', label: 'QC' }, { key: 'dispatch', label: 'Dispatch' },
  { key: 'requests', label: 'Requests' }, { key: 'inventory', label: 'Inventory' }, { key: 'batches', label: 'Batches' }, { key: 'activity', label: 'Activity' },
] as const;
type ReportKind = typeof kinds[number]['key'];

function normalize(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.logs)) return value.logs;
  if (value && typeof value === 'object') return Object.entries(value).map(([metric, amount]) => ({ metric, amount }));
  return [];
}
function humanize(value: string): string { return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()); }
function flatten(row: any): Record<string, string> {
  return Object.fromEntries(Object.entries(row || {}).filter(([key, value]) => !key.startsWith('_') && value !== null && typeof value !== 'object').map(([key, value]) => [key, String(value)]));
}
function escapeCsv(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)); }
function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export default function ReportsScreen() {
  const { session } = useAuth();
  const [kind, setKind] = useState<ReportKind>('summary');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ from: '', to: '', result: '', status: '' });
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const dates = { ...(appliedFilters.from ? { from: appliedFilters.from } : {}), ...(appliedFilters.to ? { to: appliedFilters.to } : {}) };
      const data = kind === 'summary' ? await api.reports.summary()
        : kind === 'qc' ? await api.reports.qc({ ...dates, ...(appliedFilters.result ? { result: appliedFilters.result } : {}) })
          : kind === 'dispatch' ? await api.reports.dispatch(dates)
            : kind === 'requests' ? await api.reports.dispatchRequests({ ...dates, ...(appliedFilters.status ? { status: appliedFilters.status } : {}) })
              : kind === 'inventory' ? await api.reports.inventory()
                : kind === 'batches' ? await api.reports.batches({ ...dates, ...(appliedFilters.status ? { status: appliedFilters.status } : {}) })
                  : await api.activity();
      if (requestId === requestSequence.current) setRows(normalize(data));
    } catch (error: any) {
      if (requestId === requestSequence.current) {
        Alert.alert('Could not load report', error?.message || 'Connect to the server and try again.');
        setRows([]);
      }
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [kind, appliedFilters]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const selectKind = (nextKind: ReportKind) => {
    if (nextKind === kind) return;
    setKind(nextKind);
    setRows([]);
    setLoading(true);
    setResult('');
    setStatus('');
    setAppliedFilters((previous) => ({ ...previous, result: '', status: '' }));
  };

  const applyFilters = () => {
    if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
      Alert.alert('Check the date format', 'Enter dates as YYYY-MM-DD using a real calendar date.');
      return;
    }
    if (from && to && from > to) {
      Alert.alert('Check the date range', 'The start date must be on or before the end date.');
      return;
    }
    setRows([]);
    setLoading(true);
    setAppliedFilters({ from, to, result, status });
  };

  const displayRows = useMemo(() => rows.slice(0, 250), [rows]);
  const visibleFields = useMemo(() => {
    const first = rows.map(flatten).find((item) => Object.keys(item).length > 0) || {};
    return Object.keys(first).slice(0, 7);
  }, [rows]);

  const exportCsv = async () => {
    if (!rows.length) { Alert.alert('No report data', 'Load a report before exporting it.'); return; }
    try {
      const fields = [...new Set(rows.flatMap((row) => Object.keys(flatten(row))))].filter((key) => !key.startsWith('_'));
      const text = [fields.map(escapeCsv).join(','), ...rows.map((row) => {
        const flat = flatten(row); return fields.map((key) => escapeCsv(flat[key] || '')).join(',');
      })].join('\n');
      const file = new File(Paths.cache, `product-scanning-${kind}-${Date.now()}.csv`);
      await file.create();
      await file.write(text);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export report CSV' });
      else Alert.alert('CSV saved', file.uri);
    } catch (error: any) { Alert.alert('Export failed', error?.message || 'Could not create the CSV file.'); }
  };

  const exportPdf = async () => {
    if (!rows.length) { Alert.alert('No report data', 'Load a report before exporting it.'); return; }
    try {
      const fields = visibleFields.length ? visibleFields : Object.keys(flatten(rows[0])).slice(0, 6);
      const tableRows = rows.map((row) => {
        const flat = flatten(row);
        return `<tr>${fields.map((field) => `<td>${escapeHtml(flat[field] || '')}</td>`).join('')}</tr>`;
      }).join('');
      const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{font-family:Arial,sans-serif;padding:20px;color:#172033}h1{font-size:20px}p{color:#64748b;font-size:12px}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #d9e1ec;padding:7px;text-align:left;vertical-align:top}th{background:#f1f5f9;text-transform:capitalize}</style></head><body><h1>${escapeHtml(kinds.find((item) => item.key === kind)?.label || 'Report')}</h1><p>Generated ${new Date().toLocaleString()} · ${rows.length} records</p><table><thead><tr>${fields.map((field) => `<th>${escapeHtml(humanize(field))}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
      const file = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Export report PDF' });
      else await Print.printAsync({ html });
    } catch (error: any) { Alert.alert('Export failed', error?.message || 'Could not generate the PDF.'); }
  };

  if (session?.user.role !== 'ADMIN') return <LimitedAccessScreen />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        <SectionHeader title="Reports" subtitle="Review activity and export server data." />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds}>
          {kinds.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: kind === item.key }} onPress={() => selectKind(item.key)} style={[styles.kind, kind === item.key && styles.kindActive]}><Text style={[styles.kindText, kind === item.key && styles.kindTextActive]}>{item.label}</Text></Pressable>)}
        </ScrollView>
        {['qc', 'dispatch', 'requests', 'batches'].includes(kind) ? <Card style={styles.filters}>
          <View style={styles.dateFields}><Field containerStyle={styles.dateField} label="From" placeholder="YYYY-MM-DD" value={from} onChangeText={setFrom} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={10} /><Field containerStyle={styles.dateField} label="To" placeholder="YYYY-MM-DD" value={to} onChangeText={setTo} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" maxLength={10} /></View>
          {kind === 'qc' ? <View style={styles.chips}>{['', 'PASS', 'FAIL'].map((value) => <Pressable key={value || 'all'} accessibilityRole="radio" accessibilityState={{ selected: result === value }} onPress={() => setResult(value)} style={[styles.filterChip, result === value && styles.filterChipActive]}><Text style={[styles.filterText, result === value && styles.filterTextActive]}>{value || 'All results'}</Text></Pressable>)}</View> : null}
          {kind === 'requests' || kind === 'batches' ? <View style={styles.chips}>{['', ...(kind === 'requests' ? ['PENDING', 'APPROVED', 'REJECTED'] : ['CREATED', 'QC_PASSED', 'QC_FAILED', 'DISPATCHED'])].map((value) => <Pressable key={value || 'all'} accessibilityRole="radio" accessibilityState={{ selected: status === value }} onPress={() => setStatus(value)} style={[styles.filterChip, status === value && styles.filterChipActive]}><Text style={[styles.filterText, status === value && styles.filterTextActive]}>{value || 'All statuses'}</Text></Pressable>)}</View> : null}
          <Button title="Apply filters" onPress={applyFilters} />
        </Card> : null}
        <View style={styles.exportRow}><Button title="Export CSV" variant="secondary" icon={<Ionicons name="download-outline" size={16} color={colors.text} />} onPress={() => void exportCsv()} style={{ flex: 1 }} /><Button title="Export PDF" variant="secondary" icon={<Ionicons name="document-text-outline" size={16} color={colors.text} />} onPress={() => void exportPdf()} style={{ flex: 1 }} /></View>
        <Text style={styles.resultMeta}>{rows.length} records{rows.length > displayRows.length ? ` · showing ${displayRows.length}` : ''}</Text>
        {loading && !rows.length ? <LoadingView label="Loading report…" /> : displayRows.length === 0 ? <EmptyState title="No report rows" message="Try a different report or date filter." /> : displayRows.map((row, index) => {
          const flat = flatten(row);
          const titleKey = ['product_name', 'batch_number', 'name', 'metric', 'action', 'event', 'user_name'].find((key) => flat[key]);
          const title = titleKey ? flat[titleKey] : `Record ${index + 1}`;
          const statusKey = ['status', 'result'].find((key) => flat[key]);
          return <Card key={String(row.id ?? row._id ?? `${kind}-${index}`)} style={styles.record}>
            <View style={styles.recordHead}><Text style={styles.recordTitle} numberOfLines={2}>{humanize(title)}</Text>{statusKey ? <Badge status={flat[statusKey]} label={flat[statusKey]} /> : null}</View>
            {Object.entries(flat).filter(([key]) => key !== titleKey && key !== statusKey).slice(0, 6).map(([key, value]) => <View key={key} style={styles.detail}><Text style={styles.detailLabel}>{humanize(key)}</Text><Text style={styles.detailValue} numberOfLines={2}>{value}</Text></View>)}
          </Card>;
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 42 },
  kinds: { gap: 8 },
  kind: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  kindActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  kindTextActive: { color: '#fff' },
  filters: { gap: spacing.sm },
  dateFields: { flexDirection: 'row', gap: spacing.sm },
  dateField: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: '#fff' },
  exportRow: { flexDirection: 'row', gap: spacing.sm },
  resultMeta: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
  record: { gap: 6 },
  recordHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  recordTitle: { color: colors.text, fontSize: 14, fontWeight: '800', flex: 1 },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  detailLabel: { color: colors.textFaint, fontSize: 12, flex: 1 },
  detailValue: { color: colors.textMuted, fontSize: 12, fontWeight: '600', flex: 1.2, textAlign: 'right' },
});
