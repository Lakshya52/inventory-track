import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { Button, Card, EmptyState, Field, LoadingView, Screen, SectionHeader } from '../components/ui';
import type { EntityId } from '../types';
import { colors, spacing } from '../theme';
import LimitedAccessScreen from './LimitedAccessScreen';

function rowsOf(value: any): any[] { return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []; }

export default function ProductionScreen() {
  const { session } = useAuth();
  const { online } = useSync();
  const [tab, setTab] = useState<'batches' | 'fixes'>('batches');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    if (!online) {
      setLoadError('Production records are not cached. Connect to the server to view them.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try { setRows(rowsOf(tab === 'batches' ? await api.production.batches() : await api.production.fixRecords())); }
    catch (error: any) { setLoadError(error?.message || 'Could not load production data.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [tab, online]);
  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));

  const handoff = async (batch: any) => {
    if (!online) { Alert.alert('Connection required', 'Connect to the server before sending a batch to QC.'); return; }
    try { await api.production.submitForQc(batch.barcode_value || batch.barcode); Alert.alert('Sent to QC', `${batch.batch_number || 'Batch'} is now in the QC queue.`); await load(); }
    catch (error: any) { Alert.alert('Could not send to QC', error?.message || 'Please try again.'); }
  };
  const fix = async () => {
    if (!online) { Alert.alert('Connection required', 'Connect to the server before recording a batch fix.'); return; }
    if (!selected || !description.trim()) { Alert.alert('Describe the issue', 'Add a short note so the correction is traceable.'); return; }
    setSaving(true);
    try { await api.production.fixBatch((selected.id ?? selected._id) as EntityId, description.trim()); setSelected(null); setDescription(''); await load(); }
    catch (error: any) { Alert.alert('Could not create fix request', error?.message || 'Please try again.'); }
    finally { setSaving(false); }
  };

  if (session?.user.role !== 'ADMIN') return <LimitedAccessScreen />;
  if (loading && rows.length === 0) return <Screen><LoadingView label="Loading production queue…" /></Screen>;
  return <Screen><ScrollView contentContainerStyle={styles.content} alwaysBounceVertical refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
    <SectionHeader title="Production" subtitle="Correct batch records and hand finished goods to QC." />
    {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
    <View style={styles.tabs}>{(['batches', 'fixes'] as const).map((key) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} style={({ pressed }) => [styles.tab, tab === key && styles.tabActive, pressed && styles.tabPressed]} onPress={() => setTab(key)}><Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{key === 'batches' ? 'Production batches' : 'Fix history'}</Text></Pressable>)}</View>
    {!rows.length ? <EmptyState title={loadError ? 'Production data unavailable' : tab === 'batches' ? 'No production batches' : 'No fix history'} message={loadError || 'The list is loaded from the shared application server.'} /> : rows.map((item, index) => <Card key={String(item.id ?? item._id ?? index)} style={styles.card}>
      <View style={{ minWidth: 0 }}><Text style={styles.title}>{item.product_name || item.name || 'Batch'}</Text><Text style={styles.meta}>{item.batch_number || item.barcode_value || item.barcode || '—'} · {item.status || item.action || ''}</Text>{item.description ? <Text style={styles.meta}>{item.description}</Text> : null}</View>
      {tab === 'batches' ? <View style={styles.buttons}><Button title="Send to QC" small disabled={!online} onPress={() => void handoff(item)} /><Button title="Record fix" small disabled={!online} variant="secondary" icon={<Ionicons name="build-outline" size={16} color={colors.warning} />} onPress={() => { setSelected(item); setDescription(''); }} /></View> : null}
    </Card>)}
  </ScrollView>
    <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}><Screen edges={['top', 'bottom']}><ScrollView contentContainerStyle={styles.modal}>
      <SectionHeader title="Record batch fix" subtitle={selected?.batch_number || selected?.product_name || ''} right={<Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={styles.closeButton} onPress={() => setSelected(null)}><Ionicons name="close" size={22} color={colors.text} /></Pressable>} />
      <Field label="Fix description" value={description} onChangeText={setDescription} multiline placeholder="What was corrected?" />
      <Button title="Save fix record" loading={saving} onPress={() => void fix()} />
    </ScrollView></Screen></Modal>
  </Screen>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, paddingBottom: 42 },
  tabs: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: 14, padding: 4 },
  tab: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 10, borderRadius: 11 },
  tabActive: { backgroundColor: colors.surface },
  tabPressed: { opacity: 0.75 },
  tabText: { fontSize: 13, color: colors.textMuted, fontWeight: '700', textAlign: 'center' },
  tabTextActive: { color: colors.primary },
  card: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.md },
  title: { fontSize: 15, color: colors.text, fontWeight: '800' },
  error: { fontSize: 13, lineHeight: 19, color: colors.warning, backgroundColor: colors.warningSoft, padding: spacing.md, borderRadius: 12 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  buttons: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modal: { padding: spacing.lg, gap: spacing.md },
});
