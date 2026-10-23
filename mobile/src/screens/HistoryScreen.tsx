import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { getDispatchRecords, getQcRecords } from '../db/database';
import { Badge, Card, EmptyState, Field, Screen, SectionHeader } from '../components/ui';
import LimitedAccessScreen from './LimitedAccessScreen';
import { colors, spacing } from '../theme';
import { formatDate } from '../utils/format';
import type { DispatchRecord, QcRecord } from '../types';

export default function HistoryScreen() {
  const { session } = useAuth();
  const { sync } = useSync();
  const [qcRecords, setQcRecords] = useState<QcRecord[]>([]);
  const [dispatchRecords, setDispatchRecords] = useState<DispatchRecord[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const role = session?.user.role;

  const load = useCallback(async () => {
    if (role === 'QC') {
      setQcRecords(await getQcRecords(150));
    } else if (role === 'DISPATCH') {
      setDispatchRecords(await getDispatchRecords(150));
    }
  }, [role]);

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
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return role === 'QC' ? qcRecords : dispatchRecords;
    return (role === 'QC' ? qcRecords : dispatchRecords).filter((item: any) =>
      [item.product_name, item.product_sku, item.batch_number]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [dispatchRecords, qcRecords, role, search]);

  if (role === 'ADMIN' || role === 'PRODUCTION' || !role) {
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
              Local records stay visible offline. Pull to refresh after a sync.
            </Text>
          </View>
          <View style={styles.heroIcon}>
            <Ionicons name="time-outline" size={26} color={colors.purple} />
          </View>
        </View>

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="All records"
            subtitle={`${filtered.length} record${filtered.length === 1 ? '' : 's'} on this device`}
            right={<Badge status="APPLIED" label="Offline first" />}
          />
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search product, SKU, or batch"
            autoCapitalize="none"
          />

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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.purple },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
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
  recordTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  recordMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  recordRemarks: { fontSize: 11, color: colors.textFaint, marginTop: 3, lineHeight: 15 },
});
