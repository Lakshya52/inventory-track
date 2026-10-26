import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'qrcode';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, EmptyState, Field, LoadingView, Screen, SectionHeader } from '../components/ui';
import type { EntityId } from '../types';
import { colors, spacing } from '../theme';
import LimitedAccessScreen from './LimitedAccessScreen';

function rowsOf(value: any): any[] { return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []; }
function idOf(item: any): EntityId { return item.id ?? item._id; }

export default function QrJobsScreen() {
  const { session } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [productId, setProductId] = useState<EntityId | null>(null);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [details, setDetails] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [jobResult, productRows] = await Promise.all([api.qc.qrJobs(search), api.listProducts()]);
      setJobs(rowsOf(jobResult)); setProducts(productRows || []);
      setProductId((current) => current || productRows?.[0]?.id || null);
    } catch (error: any) { Alert.alert('Could not load QR jobs', error?.message || 'Connect to the server and refresh.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [search]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const open = async (job: any) => {
    setSelectedJob(job); setDetailLoading(true); setDetails(null);
    try { setDetails(await api.getQrJob(idOf(job))); }
    catch (error: any) { Alert.alert('Could not open QR job', error?.message || 'Please try again.'); setSelectedJob(null); }
    finally { setDetailLoading(false); }
  };

  const create = async () => {
    const amount = Number(quantity);
    if (!productId || !Number.isInteger(amount) || amount < 1) { Alert.alert('Check job details', 'Choose a product and enter a whole number of labels.'); return; }
    setCreating(true);
    try {
      const result = await api.qc.createQrJob(productId, amount);
      Alert.alert('QR job created', result?.message || `${amount} QR labels are ready.`);
      setSelectedJob(result?.job || result); setDetails(result); await load();
    } catch (error: any) { Alert.alert('Could not create QR job', error?.message || 'Please try again.'); }
    finally { setCreating(false); }
  };

  const printLabels = async (labelRows: any[]) => {
    if (!labelRows?.length) { Alert.alert('No labels', 'This job has no printable labels.'); return; }
    try {
      const htmlLabels = await Promise.all(labelRows.map(async (label) => {
        const value = String(label.qr_value || label.code || '');
        const svg = await QRCode.toString(value, { type: 'svg', margin: 1, width: 150 });
        return `<article><div class="qr">${svg}</div><b>${String(label.batch_number || details?.job?.job_code || selectedJob?.job_code || '').replace(/[&<>]/g, '')}</b><small>${value.replace(/[&<>]/g, '')}</small></article>`;
      }));
      const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{font-family:Arial;margin:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}article{border:1px dashed #64748b;padding:8px;text-align:center;page-break-inside:avoid;display:flex;flex-direction:column;align-items:center;gap:4px}.qr svg{width:100px;height:100px}small{font-size:8px;word-break:break-all}</style></head><body>${htmlLabels.join('')}</body></html>`;
      const file = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Print or share QR labels' });
      else await Print.printAsync({ html });
    } catch (error: any) { Alert.alert('Could not print labels', error?.message || 'Please try again.'); }
  };

  const reprint = async () => {
    const labels = details?.labels || [];
    if (!selectedJob || labels.length === 0) return;
    try {
      const result = await api.reprintQrLabels(idOf(selectedJob), labels.map((item: any) => idOf(item)));
      setDetails(result);
      Alert.alert('Labels prepared', `${labels.length} labels are ready to print again.`);
    } catch (error: any) { Alert.alert('Could not reprint labels', error?.message || 'Please try again.'); }
  };

  if (!['ADMIN', 'QC'].includes(session?.user.role || '')) return <LimitedAccessScreen />;
  if (loading && jobs.length === 0) return <Screen><LoadingView label="Loading QR jobs…" /></Screen>;

  return <Screen><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
    <SectionHeader title="QR label jobs" subtitle="Create or reprint labels from the shared server." />
    <Field value={search} onChangeText={setSearch} placeholder="Search by job, product, or batch" autoCapitalize="none" />
    <Card style={styles.createCard}>
      <Text style={styles.cardTitle}>Create a label job</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.products}>
        {products.map((product) => <Pressable key={String(idOf(product))} accessibilityRole="radio" accessibilityState={{ selected: String(productId) === String(idOf(product)) }} onPress={() => setProductId(idOf(product))} style={[styles.product, String(productId) === String(idOf(product)) && styles.productSelected]}><Text style={[styles.productText, String(productId) === String(idOf(product)) && styles.productTextSelected]} numberOfLines={1}>{product.name}</Text></Pressable>)}
      </ScrollView>
      <Field label="Label quantity" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
      <Button title={creating ? 'Creating…' : 'Create QR job'} loading={creating} onPress={() => void create()} />
    </Card>
    {jobs.length === 0 ? <EmptyState title="No QR jobs found" message="New jobs will appear here and can be printed as a label sheet." /> : jobs.map((job, index) => <Card key={String(idOf(job) ?? index)} style={styles.job}>
      <View style={styles.jobIcon}><Ionicons name="qr-code-outline" size={20} color={colors.primary} /></View>
      <View style={styles.jobText}><Text style={styles.cardTitle}>{job.job_code || job.product_name || `QR job ${index + 1}`}</Text><Text style={styles.meta}>{job.product_name || ''} · {job.quantity || job.label_count || 0} labels</Text></View>
      <Button title="Open" small variant="secondary" onPress={() => void open(job)} />
    </Card>)}
  </ScrollView>
    <Modal visible={!!selectedJob} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setSelectedJob(null); setDetails(null); }}>
      <Screen edges={['top', 'bottom']}><ScrollView contentContainerStyle={styles.modal}>
        <SectionHeader title={details?.job?.job_code || selectedJob?.job_code || 'QR job'} subtitle={`${details?.labels?.length || 0} labels`} right={<Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton} onPress={() => { setSelectedJob(null); setDetails(null); }}><Ionicons name="close" size={22} color={colors.text} /></Pressable>} />
        {detailLoading ? <LoadingView label="Loading labels…" /> : <>
          <View style={styles.actions}><Button title="Print labels" onPress={() => void printLabels(details?.labels || [])} style={{ flex: 1 }} /><Button title="Prepare reprint" variant="secondary" onPress={() => void reprint()} style={{ flex: 1 }} /></View>
          {(details?.labels || []).slice(0, 100).map((label: any, index: number) => <Card key={String(idOf(label) ?? index)} style={styles.labelRow}><Text style={styles.labelNumber}>#{label.serial_no || index + 1}</Text><Text selectable style={styles.labelValue}>{label.qr_value || label.code}</Text></Card>)}
          {(details?.labels || []).length > 100 ? <Text style={styles.meta}>Showing the first 100 labels. The print sheet includes every label.</Text> : null}
        </>}
      </ScrollView></Screen>
    </Modal>
  </Screen>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 42 },
  createCard: { gap: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  products: { gap: 7 },
  product: { minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 16, maxWidth: 220 },
  productSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  productText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  productTextSelected: { color: '#fff' },
  job: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  jobIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  jobText: { flex: 1 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  modal: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  labelRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  labelNumber: { fontSize: 13, fontWeight: '800', color: colors.primary, width: 42 },
  labelValue: { color: colors.text, fontSize: 13, flex: 1 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
