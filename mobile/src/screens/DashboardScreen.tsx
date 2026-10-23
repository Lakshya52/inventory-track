import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import {
  getDispatchLocalStats,
  getDispatchRecords,
  getQcLocalStats,
  getQcRecords,
} from '../db/database';
import { Badge, Button, Card, EmptyState, Screen, SectionHeader, StatCard } from '../components/ui';
import LimitedAccessScreen from './LimitedAccessScreen';
import { colors, spacing } from '../theme';
import { formatDate, formatTime } from '../utils/format';
import type { DispatchRecord, QcRecord } from '../types';

export default function DashboardScreen() {
  const { session } = useAuth();
  const { online, syncing, pendingCount, conflictCount, sync } = useSync();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [recent, setRecent] = useState<(QcRecord | DispatchRecord)[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const role = session?.user.role;
  const userId = session?.user.id || 0;

  const load = useCallback(async () => {
    if (!role || role === 'ADMIN' || role === 'PRODUCTION') return;
    if (role === 'QC') {
      const [localStats, records] = await Promise.all([
        getQcLocalStats(userId),
        getQcRecords(5),
      ]);
      setStats(localStats);
      setRecent(records);
    } else {
      const [localStats, records] = await Promise.all([
        getDispatchLocalStats(userId),
        getDispatchRecords(5),
      ]);
      setStats(localStats);
      setRecent(records);
    }
  }, [role, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (role === 'ADMIN' || role === 'PRODUCTION' || !role) {
    return <LimitedAccessScreen />;
  }

  const refresh = async () => {
    setRefreshing(true);
    try {
      await sync();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const qcCards = [
    { label: 'Pending QC', value: stats?.pending ?? 0, icon: 'time-outline' as const, accent: colors.purple, soft: colors.purpleSoft },
    { label: 'My Tests Today', value: stats?.today ?? 0, icon: 'flask-outline' as const, accent: colors.info, soft: colors.infoSoft },
    { label: 'Passed', value: stats?.passed ?? 0, icon: 'checkmark-circle-outline' as const, accent: colors.success, soft: colors.successSoft },
    { label: 'Failed', value: stats?.failed ?? 0, icon: 'close-circle-outline' as const, accent: colors.danger, soft: colors.dangerSoft },
  ];

  const dispatchCards = [
    { label: 'Approved', value: stats?.approvedOrders ?? 0, icon: 'shield-checkmark-outline' as const, accent: colors.info, soft: colors.infoSoft },
    { label: 'Awaiting Approval', value: stats?.pendingOrders ?? 0, icon: 'hourglass-outline' as const, accent: colors.warning, soft: colors.warningSoft },
    { label: 'Ready to Raise', value: stats?.ready ?? 0, icon: 'cube-outline' as const, accent: colors.purple, soft: colors.purpleSoft },
    { label: 'Dispatched Today', value: stats?.dispatchedToday ?? 0, icon: 'car-outline' as const, accent: colors.success, soft: colors.successSoft },
  ];

  const cards = role === 'QC' ? qcCards : dispatchCards;

  return (
    <Screen>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>{role} DASHBOARD</Text>
            <Text style={styles.title}>Hello, {session?.user.name?.split(' ')[0] || 'there'}</Text>
            <Text style={styles.subtitle}>
              {online ? 'Online — queued work syncs automatically.' : 'Offline — your work is saved on this device.'}
            </Text>
          </View>
          <View style={[styles.connectionDot, { backgroundColor: online ? colors.successSoft : colors.warningSoft }]}>
            <Ionicons
              name={online ? 'wifi-outline' : 'cloud-offline-outline'}
              size={24}
              color={online ? colors.success : colors.warning}
            />
          </View>
        </View>

        <Card style={styles.syncCard}>
          <View style={styles.syncRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.syncTitle}>
                {syncing ? 'Syncing queued work...' : `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting to sync`}
              </Text>
              <Text style={styles.syncHint}>
                {conflictCount > 0
                  ? `${conflictCount} conflict${conflictCount === 1 ? '' : 's'} need review in the Sync tab.`
                  : 'QC and dispatch submissions are queued safely when offline.'}
              </Text>
            </View>
            <Button
              title={syncing ? 'Syncing' : 'Sync now'}
              variant="secondary"
              small
              loading={syncing}
              onPress={() => void sync()}
            />
          </View>
        </Card>

        <View style={styles.statGrid}>
          {cards.map((card) => (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={<Ionicons name={card.icon} size={18} color={card.accent} />}
              accent={card.accent}
              soft={card.soft}
            />
          ))}
        </View>

        <View style={styles.actions}>
          <Button
            title={role === 'QC' ? 'Open QC group scan' : 'Open dispatch group scan'}
            onPress={() => router.push('/scan')}
            style={{ flex: 1 }}
          />
          <Button
            title="History"
            variant="secondary"
            onPress={() => router.push('/history')}
            style={{ flex: 1 }}
          />
        </View>

        <Card>
          <SectionHeader
            title="Recent activity"
            subtitle={role === 'QC' ? 'Your latest QC tests' : 'Your latest dispatches'}
            right={<Badge status="APPLIED" label="Local" />}
          />
          {recent.length === 0 ? (
            <EmptyState title="No activity yet" message="Completed work will appear here, including work waiting to sync." />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {recent.map((item: any) => (
                <View key={`${item.id}-${item.created_at}`} style={styles.activityRow}>
                  <View style={styles.activityIcon}>
                    <Ionicons
                      name={role === 'QC'
                        ? item.result === 'PASS' ? 'checkmark-circle-outline' : 'close-circle-outline'
                        : 'car-outline'}
                      size={18}
                      color={role === 'QC'
                        ? item.result === 'PASS' ? colors.success : colors.danger
                        : colors.info}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.activityTitle} numberOfLines={1}>{item.product_name}</Text>
                    <Text style={styles.activityMeta} numberOfLines={1}>
                      {item.batch_number} · {formatDate(item.created_at)}
                    </Text>
                  </View>
                  {role === 'QC' ? (
                    <Badge status={item.result === 'PASS' ? 'QC_PASSED' : 'QC_FAILED'} label={item.result} />
                  ) : (
                    <Text style={styles.activityTime}>{formatTime(item.created_at)}</Text>
                  )}
                </View>
              ))}
            </View>
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
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.primary },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  connectionDot: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  syncCard: { padding: spacing.md },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  syncTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  syncHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  activityIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  activityMeta: { fontSize: 11, color: colors.textFaint, marginTop: 1 },
  activityTime: { fontSize: 11, color: colors.textFaint },
});
