import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { getDispatchRecords, getQcRecords } from '../db/database';
import { Badge, Button, Card, EmptyState, Field, Screen, SectionHeader } from '../components/ui';
import LimitedAccessScreen from './LimitedAccessScreen';
import { colors, spacing } from '../theme';
import { formatDate } from '../utils/format';
import type { DispatchRecord, QcRecord } from '../types';

export default function HistoryScreen() {
  const { session } = useAuth();
  const { sync, pendingCount } = useSync();
  const router = useRouter();
  const [qcRecords, setQcRecords] = useState<QcRecord[]>([]);
  const [dispatchRecords, setDispatchRecords] = useState<DispatchRecord[]>([]);
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const role = session?.user.role;
  const userId = session?.user.id;

  const load = useCallback(async () => {
    setLoadError('');
    try {
      if (role === 'QC' && userId) {
        setQcRecords(await getQcRecords(150, 0, userId));
      } else if (role === 'DISPATCH') {
        setDispatchRecords(await getDispatchRecords(150));
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load history from this device.');
    }
  }, [role, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await sync();
      await load();
    } catch (err: any) {
      setLoadError(err?.message || 'Could not refresh history.');
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (role === 'QC' ? qcRecords : dispatchRecords).filter((item: any) => {
      const matchesSearch = !needle || [item.product_name, item.product_sku, item.batch_number]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
      const matchesResult = role !== 'QC' || resultFilter === 'ALL' || item.result === resultFilter;
      return matchesSearch && matchesResult;
    });
  }, [dispatchRecords, qcRecords, role, search, resultFilter]);

  if (role === 'ADMIN' || !role) {
    return <LimitedAccessScreen />;
  }

  return (
    <Screen>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>{role} HISTORY</Text>
            <Text style={styles.title}>{role === 'QC' ? 'QC test history' : 'Dispatch history'}</Text>
            <Text style={styles.subtitle}>
              Synced records stay on this device. Work waiting to sync is in the queue below.
            </Text>
          </View>
          <View style={styles.heroIcon}>
            <Ionicons name="time-outline" size={26} color={colors.purple} />
          </View>
        </View>

        {loadError ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}

        {pendingCount > 0 ? (
          <Card style={styles.pendingCard}>
            <View style={styles.pendingCopy}>
              <Ionicons name="cloud-upload-outline" size={19} color={colors.warning} />
              <View style={styles.pendingText}>
                <Text style={styles.pendingTitle}>{pendingCount} item{pendingCount === 1 ? '' : 's'} waiting to sync</Text>
                <Text style={styles.pendingHint}>Review the queue or retry when your connection is available.</Text>
              </View>
            </View>
            <Button title="Review sync queue" variant="secondary" small onPress={() => router.push('/sync')} />
          </Card>
        ) : null}

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="All records"
            subtitle={`${filtered.length} record${filtered.length === 1 ? '' : 's'} on this device`}
            right={<Badge status="APPLIED" label="On device" />}
          />
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search product, SKU, or batch"
            autoCapitalize="none"
          />
          {role === 'QC' ? (
            <View style={styles.filterRow}>
              {(['ALL', 'PASS', 'FAIL'] as const).map((filter) => {
                const selected = resultFilter === filter;
                return (
                  <Pressable
                    key={filter}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setResultFilter(filter)}
                    style={[styles.filterChip, selected && styles.filterChipSelected]}
                  >
                    <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                      {filter === 'ALL' ? 'All results' : filter}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState
              title={search ? 'No matching records' : 'No history yet'}
              message={search ? 'Try a different search.' : 'Completed work will appear here after it is saved locally.'}
            />
          ) : role === 'QC' ? (
            (filtered as QcRecord[]).map((record) => (
              <View key={`${record.id}-${record.created_at}`} style={styles.recordRow}>
                <View style={[styles.recordIcon, { backgroundColor: record.result === 'PASS' ? colors.successSoft : colors.dangerSoft }]}>
                  <Ionicons
                    name={record.result === 'PASS' ? 'checkmark-circle-outline' : 'close-circle-outline'}
                    size={18}
                    color={record.result === 'PASS' ? colors.success : colors.danger}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.recordTitle} numberOfLines={1}>{record.product_name}</Text>
                  <Text style={styles.recordMeta} numberOfLines={1}>
                    {record.batch_number} · {formatDate(record.created_at)}
                  </Text>
                  {record.remarks ? (
                    <Text style={styles.recordRemarks} numberOfLines={2}>{record.remarks}</Text>
                  ) : null}
                  {record.images && photoCount(record.images) > 0 ? (
                    <Text style={styles.recordPhotoCount}>
                      {photoCount(record.images)} photo{photoCount(record.images) === 1 ? '' : 's'}
                    </Text>
                  ) : null}
                </View>
                <Badge status={record.result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED'} label={record.result} />
              </View>
            ))
          ) : (
            (filtered as DispatchRecord[]).map((record) => (
              <View key={`${record.id}-${record.created_at}`} style={styles.recordRow}>
                <View style={[styles.recordIcon, { backgroundColor: colors.infoSoft }]}>
                  <Ionicons name="car-outline" size={18} color={colors.info} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.recordTitle} numberOfLines={1}>{record.product_name}</Text>
                  <Text style={styles.recordMeta} numberOfLines={1}>
                    {record.batch_number} · {formatDate(record.created_at)}
                  </Text>
                  {record.remarks ? (
                    <Text style={styles.recordRemarks} numberOfLines={2}>{record.remarks}</Text>
                  ) : null}
                </View>
                <Badge status="DISPATCHED" label="Dispatched" />
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function photoCount(images: string): number {
  try {
    const parsed = JSON.parse(images);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 40 },
  pendingCard: { gap: spacing.md, borderColor: colors.warningSoft },
  pendingCopy: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  pendingText: { flex: 1, gap: 3 },
  pendingTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  pendingHint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.purple },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  recordIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  recordMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  recordRemarks: { fontSize: 12, color: colors.textFaint, marginTop: 4, lineHeight: 17 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  filterChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  filterTextSelected: { color: colors.primaryDark },
  recordPhotoCount: { fontSize: 12, color: colors.info, marginTop: 4 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { flex: 1, fontSize: 12, color: colors.danger },
});
