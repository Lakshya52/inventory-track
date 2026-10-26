import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { Badge, Button, Card, EmptyState, Field, LoadingView, Screen, SectionHeader } from '../components/ui';
import type { EntityId } from '../types';
import { colors, spacing } from '../theme';
import LimitedAccessScreen from './LimitedAccessScreen';

type Module = 'products' | 'users' | 'clients' | 'vendors' | 'masters' | 'bag-quantities' | 'locations';
type InputSpec = { key: string; label: string; kind?: 'number' | 'email' | 'password' | 'multiline'; optional?: boolean };

const configs: Record<Module, { title: string; fields: InputSpec[] }> = {
  products: { title: 'Products', fields: [
    { key: 'name', label: 'Product name' }, { key: 'sku', label: 'SKU' }, { key: 'price', label: 'Unit price', kind: 'number' },
    { key: 'quantity', label: 'Quantity', kind: 'number' }, { key: 'cas_number', label: 'CAS number' }, { key: 'molecular_formula', label: 'Molecular formula' },
    { key: 'grade', label: 'Grade' }, { key: 'purity', label: 'Purity' }, { key: 'physical_state', label: 'Physical state', optional: true },
    { key: 'hsn_code', label: 'HSN code', optional: true }, { key: 'manufacturer', label: 'Manufacturer', optional: true },
    { key: 'hazard_classification', label: 'Hazard classification', optional: true }, { key: 'storage_conditions', label: 'Storage conditions', optional: true },
    { key: 'description', label: 'Description', kind: 'multiline', optional: true },
  ] },
  users: { title: 'Users', fields: [
    { key: 'name', label: 'Full name' }, { key: 'email', label: 'Email', kind: 'email' }, { key: 'password', label: 'Temporary password', kind: 'password' },
  ] },
  clients: { title: 'Clients', fields: [
    { key: 'name', label: 'Client name' }, { key: 'contact_person', label: 'Contact person', optional: true },
    { key: 'email', label: 'Email', kind: 'email', optional: true }, { key: 'phone', label: 'Phone', optional: true },
    { key: 'address', label: 'Address', kind: 'multiline', optional: true }, { key: 'gst_number', label: 'GST number', optional: true },
  ] },
  vendors: { title: 'Vendors', fields: [
    { key: 'name', label: 'Vendor name' }, { key: 'vendor_code', label: 'Vendor code', optional: true }, { key: 'contact_person', label: 'Contact person', optional: true },
    { key: 'email', label: 'Email', kind: 'email', optional: true }, { key: 'phone', label: 'Phone', optional: true }, { key: 'address', label: 'Address', kind: 'multiline', optional: true },
  ] },
  masters: { title: 'Grades', fields: [{ key: 'name', label: 'Grade name' }] },
  'bag-quantities': { title: 'Bag quantities', fields: [{ key: 'quantity', label: 'Quantity', kind: 'number' }, { key: 'unit', label: 'Unit' }] },
  locations: { title: 'Shelf locations', fields: [
    { key: 'location_code', label: 'Location code' }, { key: 'description', label: 'Description', optional: true }, { key: 'warehouse', label: 'Warehouse', optional: true },
    { key: 'rack', label: 'Rack', optional: true }, { key: 'shelf', label: 'Shelf', optional: true },
  ] },
};

function active(item: any): boolean { return item?.is_active === true || Number(item?.is_active) === 1; }
function idOf(item: any): EntityId { return item.id ?? item._id; }

export default function ManagementScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const module = (section || 'products') as Module;
  const config = configs[module] || configs.products;
  const { session } = useAuth();
  const { online } = useSync();
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [role, setRole] = useState<'ADMIN' | 'QC' | 'DISPATCH'>('QC');
  const [passwordUser, setPasswordUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canManage = session?.user.role === 'ADMIN';
  const masterKind = module === 'bag-quantities' ? 'bag-quantities' : 'grades';
  const load = useCallback(async () => {
    setError('');
    if (!online) {
      setError('Offline · current server data may be out of date. Reconnect to refresh or make changes.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const data = module === 'products' ? await api.listProducts()
        : module === 'users' ? await api.users.list()
          : module === 'clients' ? await api.clients.list()
            : module === 'vendors' ? await api.vendors.list('all')
              : module === 'masters' || module === 'bag-quantities' ? await api.masters.list(masterKind)
                : await api.shelfLocations.list();
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(e?.message || 'Could not load records.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [module, masterKind, online]);
  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return !q ? rows : rows.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
  }, [query, rows]);

  const startCreate = () => {
    setEditing(null); setForm({}); setRole('QC'); setError(''); setModal(true);
  };
  const startEdit = (item: any) => {
    setEditing(item);
    setForm(Object.fromEntries(config.fields.map((field) => [field.key, item[field.key] == null ? '' : String(item[field.key])] )));
    setRole(item.role || 'QC'); setError(''); setModal(true);
  };
  const save = async () => {
    if (!online) { setError('Connect to the server before saving changes.'); return; }
    const missing = config.fields.filter((f) => !f.optional && !(form[f.key] || '').trim());
    if (missing.length) { setError(`Enter ${missing[0].label.toLowerCase()}.`); return; }
    setSaving(true); setError('');
    const data: any = {};
    for (const spec of config.fields) {
      const raw = (form[spec.key] || '').trim();
      if (!raw && spec.optional) continue;
      data[spec.key] = spec.kind === 'number' ? Number(raw) : raw;
    }
    try {
      if (module === 'users') {
        if (editing) await api.users.update(String(editing.role).toLowerCase(), idOf(editing), { name: data.name, email: data.email });
        else await api.users.add({ ...data, role });
      } else if (module === 'products') {
        if (editing) await api.products.update(idOf(editing), data); else await api.products.create(data);
      } else if (module === 'clients') {
        if (editing) await api.clients.update(idOf(editing), data); else await api.clients.create(data);
      } else if (module === 'vendors') {
        if (editing) await api.vendors.update(idOf(editing), data); else await api.vendors.create(data);
      } else if (module === 'masters' || module === 'bag-quantities') {
        if (editing) await api.masters.update(masterKind, idOf(editing), data);
        else await api.masters.create(masterKind, data);
      } else if (module === 'locations') {
        if (editing) await api.shelfLocations.update(idOf(editing), data); else await api.shelfLocations.create(data);
      }
      setModal(false); await load();
    } catch (e: any) { setError(e?.message || 'Could not save record.'); }
    finally { setSaving(false); }
  };

  const remove = (item: any) => {
    if (!online) { setError('Connect to the server before changing records.'); return; }
    const deactivates = module === 'vendors';
    return Alert.alert(deactivates ? 'Deactivate this vendor?' : 'Delete this record?', 'This action uses the existing web service and may affect future selection lists.', [
    { text: 'Cancel', style: 'cancel' },
    { text: deactivates ? 'Deactivate' : 'Delete', style: 'destructive', onPress: () => { void (async () => {
      try {
        if (module === 'users') await api.users.remove(String(item.role).toLowerCase(), idOf(item));
        else if (module === 'products') await api.products.remove(idOf(item));
        else if (module === 'clients') await api.clients.remove(idOf(item));
        else if (module === 'vendors') await api.vendors.setStatus(idOf(item), false);
        else if (module === 'masters' || module === 'bag-quantities') await api.masters.remove(masterKind, idOf(item));
        else await api.shelfLocations.remove(idOf(item));
        await load();
      } catch (e: any) { Alert.alert('Could not update record', e?.message || 'Please try again.'); }
    })(); } },
    ]);
  };

  const toggle = async (item: any) => {
    if (!online) { setError('Connect to the server before changing record status.'); return; }
    try {
      const enabled = !active(item);
      if (module === 'users') await api.users.setStatus(String(item.role).toLowerCase(), idOf(item), enabled);
      else if (module === 'vendors') await api.vendors.setStatus(idOf(item), enabled);
      else if (module === 'masters' || module === 'bag-quantities') await api.masters.setStatus(masterKind, idOf(item), enabled);
      await load();
    } catch (e: any) { Alert.alert('Could not update status', e?.message || 'Please try again.'); }
  };

  const resetPassword = (item: any) => {
    setPasswordUser(item); setNewPassword(''); setError('');
  };

  const savePassword = async () => {
    if (!online) { setError('Connect to the server before changing passwords.'); return; }
    if (!passwordUser || newPassword.trim().length < 8) { setError('Use a password with at least 8 characters.'); return; }
    setSaving(true); setError('');
    try {
      await api.users.changePassword(String(passwordUser.role).toLowerCase(), idOf(passwordUser), newPassword);
      setPasswordUser(null); setNewPassword(''); Alert.alert('Password updated', `New password saved for ${passwordUser.name}.`);
    } catch (e: any) { setError(e?.message || 'Could not update password.'); }
    finally { setSaving(false); }
  };

  const importProducts = async () => {
    if (!online) { setError('Connect to the server before importing products.'); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'], copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const response = await api.products.importExcel({ uri: result.assets[0].uri, name: result.assets[0].name, mimeType: result.assets[0].mimeType });
      Alert.alert('Import complete', response?.message || 'Product rows were sent to the server.'); await load();
    } catch (e: any) { Alert.alert('Import failed', e?.message || 'Could not import the selected workbook.'); }
  };

  const shareProductTemplate = async () => {
    if (!online) { setError('Connect to the server before downloading the template.'); return; }
    try {
      const uri = await api.products.downloadImportSample();
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Save product import template' });
      else Alert.alert('Template ready', uri);
    } catch (e: any) { Alert.alert('Could not download template', e?.message || 'Please try again.'); }
  };

  if (session?.user.role !== 'ADMIN' && module !== 'products') return <LimitedAccessScreen />;
  if (loading && rows.length === 0) return <Screen><LoadingView label={`Loading ${config.title.toLowerCase()}…`} /></Screen>;

  const cardTitle = (item: any) => module === 'masters' ? item.name
    : module === 'bag-quantities' ? `${item.quantity ?? ''} ${item.unit || ''}`.trim()
    : module === 'locations' ? item.location_code || item.name
      : item.name || item.product_name || item.email || 'Untitled';
  const cardMeta = (item: any) => module === 'products' ? [item.sku, item.cas_number, item.grade].filter(Boolean).join(' · ')
    : module === 'users' ? `${item.email || ''} · ${item.role || ''}`
      : module === 'clients' || module === 'vendors' ? [item.contact_person, item.phone, item.email].filter(Boolean).join(' · ')
        : module === 'masters' || module === 'bag-quantities' ? (module === 'masters' ? '' : `${item.quantity ?? ''} ${item.unit || ''}`.trim())
          : [item.warehouse, item.rack, item.shelf].filter(Boolean).join(' · ');

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} alwaysBounceVertical refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        <SectionHeader title={config.title} subtitle={`${rows.length} records · search and manage`} right={<Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={styles.closeButton} onPress={() => router.back()}><Ionicons name="close" size={22} color={colors.textMuted} /></Pressable>} />
        {error && !modal ? <Text style={styles.error}>{error}</Text> : null}
        <Field value={query} onChangeText={setQuery} placeholder={`Search ${config.title.toLowerCase()}…`} autoCapitalize="none" />
        {canManage ? <View style={styles.actions}>
          <Button title={`Add ${module === 'masters' ? 'grade' : module === 'bag-quantities' ? 'quantity' : module === 'locations' ? 'location' : config.title.slice(0, -1)}`} onPress={startCreate} disabled={!online} style={{ flex: 1 }} />
          {module === 'products' ? <><Button title="Template" variant="secondary" disabled={!online} onPress={() => void shareProductTemplate()} /><Button title="Import" variant="secondary" disabled={!online} onPress={() => void importProducts()} /></> : null}
        </View> : null}
        {filtered.length === 0 ? <EmptyState title="No records found" message={query ? 'Try a shorter search.' : 'Create the first record to start using this list.'} /> : filtered.map((item, index) => (
          <Card key={String(idOf(item) ?? index)} style={styles.record}>
            <View style={{ minWidth: 0 }}>
              <Text style={styles.name}>{cardTitle(item)}</Text>
              {!!cardMeta(item) && <Text style={styles.meta}>{cardMeta(item)}</Text>}
              {['users', 'vendors', 'masters', 'locations'].includes(module) && item.is_active !== undefined ? <Badge status={active(item) ? 'APPLIED' : 'FAILED'} label={active(item) ? 'Active' : 'Inactive'} /> : null}
            </View>
            {canManage ? <View style={styles.iconActions}>
              {module === 'users' ? <Button title="Password" small variant="secondary" disabled={!online} icon={<Ionicons name="key-outline" size={15} color={colors.primary} />} onPress={() => resetPassword(item)} style={styles.recordAction} /> : null}
              {module === 'users' || module === 'vendors' || module === 'masters' || module === 'bag-quantities' ? <Button title={active(item) ? 'Deactivate' : 'Activate'} small variant="secondary" disabled={!online} icon={<Ionicons name={active(item) ? 'pause-circle-outline' : 'play-circle-outline'} size={15} color={colors.warning} />} onPress={() => void toggle(item)} style={styles.recordAction} /> : null}
              <Button title="Edit" small variant="secondary" disabled={!online} icon={<Ionicons name="create-outline" size={15} color={colors.info} />} onPress={() => startEdit(item)} style={styles.recordAction} />
              {module !== 'vendors' ? <Button title="Delete" small variant="danger" disabled={!online} icon={<Ionicons name="trash-outline" size={15} color={colors.danger} />} onPress={() => remove(item)} style={styles.recordAction} /> : null}
            </View> : null}
          </Card>
        ))}
      </ScrollView>

      <Modal visible={modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(false)}>
        <Screen style={styles.modalScreen} edges={['top', 'bottom']}>
          <View style={styles.modalHead}><Text style={styles.modalTitle}>{editing ? 'Edit' : 'Add'} {module === 'masters' ? 'grade' : config.title.slice(0, -1)}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton} onPress={() => setModal(false)}><Ionicons name="close" size={24} color={colors.text} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            {config.fields.filter((field) => !(module === 'users' && editing && field.key === 'password')).map((field) => (
              <Field key={field.key} label={field.label} value={form[field.key] || ''} onChangeText={(value) => setForm((prev) => ({ ...prev, [field.key]: value }))}
                keyboardType={field.kind === 'number' ? 'decimal-pad' : field.kind === 'email' ? 'email-address' : 'default'}
                secureTextEntry={field.kind === 'password'} multiline={field.kind === 'multiline'} autoCapitalize={field.kind === 'email' ? 'none' : 'sentences'} />
            ))}
            {module === 'users' && !editing ? <View style={styles.roleChoices}><Text style={styles.label}>Role</Text><View style={styles.chips}>{(['QC', 'DISPATCH', 'ADMIN'] as const).map((choice) => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ selected: role === choice }} onPress={() => setRole(choice)} style={[styles.chip, role === choice && styles.chipSelected]}><Text style={[styles.chipText, role === choice && styles.chipTextSelected]}>{choice}</Text></Pressable>)}</View></View> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title={saving ? 'Saving…' : online ? editing ? 'Save changes' : 'Create' : 'Connect to save'} loading={saving} disabled={!online} onPress={() => void save()} />
          </ScrollView>
        </Screen>
      </Modal>
      <Modal visible={!!passwordUser} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPasswordUser(null)}>
        <Screen style={styles.modalScreen} edges={['top', 'bottom']}>
          <View style={styles.modalHead}><Text style={styles.modalTitle}>Reset password</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.closeButton} onPress={() => setPasswordUser(null)}><Ionicons name="close" size={24} color={colors.text} /></Pressable></View>
          <View style={styles.form}><Text style={styles.meta}>Set a new password for {passwordUser?.name}.</Text><Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" /><Text style={styles.meta}>Use at least 8 characters.</Text>{error ? <Text style={styles.error}>{error}</Text> : null}<Button title={saving ? 'Saving…' : 'Update password'} loading={saving} onPress={() => void savePassword()} /></View>
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  record: { gap: spacing.md },
  name: { fontSize: 14, color: colors.text, fontWeight: '800' },
  meta: { fontSize: 13, color: colors.textMuted, marginVertical: 4, lineHeight: 18 },
  iconActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  recordAction: { flexGrow: 1, minWidth: '46%' },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  modalScreen: { backgroundColor: colors.background },
  modalHead: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  form: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  roleChoices: { gap: 8 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 13 },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  chipTextSelected: { color: '#fff' },
});
