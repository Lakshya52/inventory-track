import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { api } from '../api/client';
import {
  getDispatchLocalStats,
  getDispatchRecords,
  getBatchesByStatus,
  getQcLocalStats,
  getQcRecords,
} from '../db/database';
import { Badge, Button, Card, EmptyState, Field, Screen, SectionHeader, StatCard } from '../components/ui';
import LimitedAccessScreen from './LimitedAccessScreen';
import { colors, spacing } from '../theme';
import { formatAge, formatDate, formatTime } from '../utils/format';
import type { Batch, DispatchRecord, QcRecord } from '../types';

export default function DashboardScreen() {
  const { session } = useAuth();
  const { online, syncing, pendingCount, conflictCount, sync } = useSync();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [recent, setRecent] = useState<(QcRecord | DispatchRecord)[]>([]);
  const [pendingBatches, setPendingBatches] = useState<Batch[]>([]);
  const [pendingSearch, setPendingSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [adminData, setAdminData] = useState<any>(null);

  const role = session?.user.role;
  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!role) return;
    setLoadError('');
    try {
      if (role === 'ADMIN') {
          if (!online) {
            setAdminData(null);
            setLoadError('Admin totals and request approvals need an internet connection.');
            return;
          }
        setAdminData(await api.dashboard.admin());
        return;
      }
      if (role === 'QC') {
        const [localStats, records, batches] = await Promise.all([
          getQcLocalStats(userId!),
          getQcRecords(5, 0, userId!),
          getBatchesByStatus(['CREATED'], 200),
        ]);
        let currentStats: any = localStats;
        let currentRecords: any[] = records;
        if (online) {
          try {
            const [serverStats, serverRecords] = await Promise.all([api.qc.stats(), api.qc.records({ limit: 5, scope: 'mine' })]);
            currentStats = {
              ...localStats,
              today: serverStats.myTestsToday ?? localStats.today,
              week: serverStats.myTestsThisWeek ?? localStats.week,
              pending: serverStats.pendingQc ?? localStats.pending,
              total: serverStats.myTotalTests ?? localStats.total,
              passRate: serverStats.myPassRate,
            };
            if (Array.isArray(serverRecords?.items)) currentRecords = serverRecords.items.slice(0, 5);
          } catch { /* Offline snapshots remain available from the device cache. */ }
        }
        setStats(currentStats);
        setRecent(currentRecords as any);
        setPendingBatches(batches);
      } else {
        const [localStats, records] = await Promise.all([
          getDispatchLocalStats(userId!),
          getDispatchRecords(5),
        ]);
        let currentStats: any = localStats;
        let currentRecords: any[] = records;
        if (online) {
          try {
            const [serverStats, serverRecords] = await Promise.all([api.dispatch.stats(), api.dispatch.records()]);
            currentStats = {
              ...localStats,
              ready: serverStats.readyToDispatch ?? localStats.ready,
              pendingOrders: serverStats.pendingOrders ?? localStats.pendingOrders,
              approvedOrders: serverStats.approvedOrders ?? localStats.approvedOrders,
              dispatchedToday: serverStats.dispatchedToday ?? localStats.dispatchedToday,
              totalDispatches: serverStats.myTotalDispatches ?? localStats.totalDispatches,
            };
            if (Array.isArray(serverRecords?.items)) currentRecords = serverRecords.items.slice(0, 5);
          } catch { /* Offline snapshots remain available from the device cache. */ }
        }
        setStats(currentStats);
        setRecent(currentRecords as any);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load the dashboard from this device.');
    }
  }, [role, userId, online]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!role) {
    return <LimitedAccessScreen />;
  }

  const refresh = async () => {
    setRefreshing(true);
    try {
      await sync();
      await load();
    } catch (err: any) {
      setLoadError(err?.message || 'Could not refresh the dashboard.');
    } finally {
      setRefreshing(false);
    }
  };

  const passRate = stats?.total
    ? (stats.passRate ?? Math.round((stats.passed / stats.total) * 100))
    : 0;
  const qcCards = [
    { label: 'My Tests Today', value: stats?.today ?? 0, icon: 'flask-outline' as const, accent: colors.info, soft: colors.infoSoft },
    { label: 'My Tests This Week', value: stats?.week ?? 0, icon: 'trending-up-outline' as const, accent: colors.purple, soft: colors.purpleSoft },
    { label: 'My Pass Rate', value: `${passRate}%`, icon: 'checkmark-circle-outline' as const, accent: passRate >= 80 ? colors.success : colors.warning, soft: passRate >= 80 ? colors.successSoft : colors.warningSoft },
    { label: 'Pending QC', value: stats?.pending ?? 0, icon: 'time-outline' as const, accent: colors.purple, soft: colors.purpleSoft },
    { label: 'My Total Tests', value: stats?.total ?? 0, icon: 'stats-chart-outline' as const, accent: colors.textMuted, soft: colors.surfaceAlt },
  ];

  const dispatchCards = [
    { label: 'Approved', value: stats?.approvedOrders ?? 0, icon: 'shield-checkmark-outline' as const, accent: colors.info, soft: colors.infoSoft },
    { label: 'Awaiting Approval', value: stats?.pendingOrders ?? 0, icon: 'hourglass-outline' as const, accent: colors.warning, soft: colors.warningSoft },
    { label: 'Ready to Raise', value: stats?.ready ?? 0, icon: 'cube-outline' as const, accent: colors.purple, soft: colors.purpleSoft },
    { label: 'Dispatched Today', value: stats?.dispatchedToday ?? 0, icon: 'car-outline' as const, accent: colors.success, soft: colors.successSoft },
  ];

  const cards = role === 'QC' ? qcCards : dispatchCards;

  if (role === 'ADMIN') {
    const statsData = adminData?.stats || {};
    const adminCards = [
      { label: 'Products', value: adminData ? statsData.totalProducts ?? 0 : '—', icon: 'flask-outline', color: colors.primary, soft: colors.primarySoft },
      { label: 'Inventory value', value: adminData ? `₹${Number(statsData.inventoryValue || 0).toLocaleString('en-IN')}` : '—', icon: 'cash-outline', color: colors.success, soft: colors.successSoft },
      { label: 'Active users', value: adminData ? `${statsData.activeUsers ?? 0}/${statsData.totalUsers ?? 0}` : '—', icon: 'people-outline', color: colors.purple, soft: colors.purpleSoft },
      { label: 'QC passed', value: adminData ? statsData.qcPassed ?? 0 : '—', icon: 'checkmark-circle-outline', color: colors.success, soft: colors.successSoft },
      { label: 'QC failed', value: adminData ? statsData.qcFailed ?? 0 : '—', icon: 'close-circle-outline', color: colors.danger, soft: colors.dangerSoft },
      { label: 'Pending requests', value: adminData ? statsData.pendingRequests ?? 0 : '—', icon: 'time-outline', color: colors.warning, soft: colors.warningSoft },
      { label: 'Active locations', value: adminData ? `${statsData.activeLocations ?? 0}/${statsData.totalLocations ?? 0}` : '—', icon: 'location-outline', color: colors.info, soft: colors.infoSoft },
    ];
    const actions = [
      { title: 'Review orders', href: '/(tabs)/orders', icon: 'clipboard-outline' },
      { title: 'Manage records', href: '/(tabs)/manage', icon: 'grid-outline' },
      { title: 'Open reports', href: '/(tabs)/reports', icon: 'bar-chart-outline' },
      { title: 'Production', href: '/production', icon: 'construct-outline' },
    ];
    return <Screen><ScrollView style={styles.screen} contentContainerStyle={styles.content} alwaysBounceVertical refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <View style={styles.hero}><View style={{ flex: 1 }}><Text style={styles.eyebrow}>ADMIN DASHBOARD</Text><Text style={styles.title}>Hello, {session?.user.name?.split(' ')[0] || 'there'}</Text><Text style={styles.subtitle}>Live totals from the shared inventory server.</Text></View><View style={styles.heroActions}><Pressable accessibilityRole="button" accessibilityLabel="Scan a QR code to view product details" onPress={() => router.push('/qr-lookup')} style={({ pressed }) => [styles.lookupButton, pressed && styles.lookupPressed]}><Ionicons name="scan-outline" size={24} color={colors.primary} /></Pressable><View style={styles.connectionDot}><Ionicons name={online ? 'wifi-outline' : 'cloud-offline-outline'} size={22} color={online ? colors.success : colors.warning} /></View></View></View>
      {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
      <View style={styles.statGrid}>{adminCards.map((card) => <StatCard key={card.label} label={card.label} value={card.value} icon={<Ionicons name={card.icon as any} size={18} color={card.color} />} accent={card.color} soft={card.soft} />)}</View>
      <View style={styles.adminActions}>{actions.map((action) => <Button key={action.title} title={action.title} variant="secondary" icon={<Ionicons name={action.icon as any} size={16} color={colors.primary} />} onPress={() => action.href.startsWith('/(tabs)/') ? router.navigate(action.href as any) : router.push(action.href as any)} style={styles.adminAction} />)}</View>
      <Card style={{ gap: spacing.sm }}><SectionHeader title="Pending dispatch requests" subtitle={adminData ? `${adminData.pendingRequests?.length || 0} need review` : 'Connect to load requests'} />{(adminData?.pendingRequests || []).slice(0, 5).map((item: any, index: number) => <View key={String(item.id ?? item._id ?? index)} style={styles.activityRow}><View style={{ flex: 1 }}><Text style={styles.activityTitle}>{item.product_name || 'Dispatch request'}</Text><Text style={styles.activityMeta}>{item.batch_number} · {item.raised_by_name || 'Dispatch team'}</Text></View><Badge status={item.status || 'PENDING'} /></View>)}{adminData && !adminData.pendingRequests?.length ? <EmptyState title="Nothing waiting" message="New dispatch requests will appear here." /> : null}<Button title="Review requests" variant="secondary" onPress={() => router.navigate('/(tabs)/orders')} /></Card>
      <Card style={{ gap: spacing.sm }}><SectionHeader title="Recent activity" subtitle="Latest server events" />{(adminData?.recentActivity || []).slice(0, 6).map((item: any, index: number) => <View key={String(item.id ?? item._id ?? index)} style={styles.activityRow}><Ionicons name="pulse-outline" size={17} color={colors.info} /><View style={{ flex: 1 }}><Text style={styles.activityTitle}>{item.action || item.event || 'Update'}</Text><Text style={styles.activityMeta} numberOfLines={2}>{item.description || item.created_at || ''}</Text></View></View>)}{!adminData?.recentActivity?.length ? <EmptyState title="No recent activity" /> : null}</Card>
    </ScrollView></Screen>;
  }
  const needle = pendingSearch.trim().toLowerCase();
  const filteredPending = !needle
    ? pendingBatches
    : pendingBatches.filter((batch) =>
        [batch.batch_number, batch.product_name, batch.product_sku, batch.barcode_value]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
      );

  return (
    <Screen>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        alwaysBounceVertical
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
          <View style={styles.heroActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Scan a QR code to view product details" onPress={() => router.push('/qr-lookup')} style={({ pressed }) => [styles.lookupButton, pressed && styles.lookupPressed]}>
              <Ionicons name="scan-outline" size={24} color={colors.primary} />
            </Pressable>
            <View style={[styles.connectionDot, { backgroundColor: online ? colors.successSoft : colors.warningSoft }]}>
              <Ionicons
                name={online ? 'wifi-outline' : 'cloud-offline-outline'}
                size={22}
                color={online ? colors.success : colors.warning}
              />
            </View>
          </View>
        </View>

        {loadError ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}

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
              title={syncing ? 'Syncing' : online ? 'Sync now' : 'Waiting for internet'}
              variant="secondary"
              small
              loading={syncing}
              disabled={!online}
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
            title={role === 'QC' ? 'Start QC scan' : 'Start dispatch scan'}
            large
            onPress={() => router.navigate({ pathname: '/(tabs)/scan', params: { autostart: '1' } })}
            icon={<Ionicons name="camera-outline" size={22} color="#fff" />}
          />
          <Button
            title="History"
            variant="secondary"
            onPress={() => router.navigate('/(tabs)/history')}
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

        {role === 'QC' ? (
          <Card style={{ gap: spacing.md }}>
            <SectionHeader
              title="Pending QC queue"
              subtitle={`${pendingBatches.length} batch${pendingBatches.length === 1 ? '' : 'es'} waiting on this device`}
              right={<Badge status="CREATED" label="Created" />}
            />
            <Field
              value={pendingSearch}
              onChangeText={setPendingSearch}
              placeholder="Search batch, product, or SKU"
              autoCapitalize="none"
            />
            {filteredPending.length === 0 ? (
              <EmptyState
                title={pendingSearch ? 'No matching batches' : 'No batches waiting for QC'}
                message={pendingSearch ? 'Try another batch number, product, or SKU.' : 'Pull to refresh or sync to download the latest QC queue.'}
              />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {filteredPending.slice(0, 8).map((batch) => (
                  <View key={batch.id} style={styles.pendingRow}>
                    <View style={styles.activityIcon}>
                      <Ionicons name="cube-outline" size={17} color={colors.purple} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.activityTitle} numberOfLines={1}>{batch.product_name}</Text>
                      <Text style={styles.activityMeta} numberOfLines={1}>
                        {batch.batch_number} · {batch.quantity} {batch.uom || 'units'}
                      </Text>
                      <Text style={styles.activityMeta} numberOfLines={1}>
                        {batch.location_code || batch.storage_location || 'Location not set'} · waiting {formatAge(batch.age_minutes)}
                      </Text>
                    </View>
                  </View>
                ))}
                {filteredPending.length > 8 ? (
                  <Text style={styles.moreHint}>
                    Showing 8 of {filteredPending.length}. Search to narrow the queue or open QC Scan.
                  </Text>
                ) : null}
                <Button title="Open QC group scan" variant="secondary" onPress={() => router.navigate({ pathname: '/(tabs)/scan', params: { autostart: '1' } })} />
              </View>
            )}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.primary },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 19 },
  connectionDot: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lookupButton: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  lookupPressed: { opacity: 0.72 },
  syncCard: { padding: spacing.md },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  syncTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  syncHint: { fontSize: 12, color: colors.textMuted, marginTop: 3, lineHeight: 17 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { gap: spacing.sm },
  adminActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  adminAction: { flexGrow: 1, minWidth: '46%' },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  activityIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  activityMeta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  activityTime: { fontSize: 12, color: colors.textFaint },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  moreHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 17 },
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
