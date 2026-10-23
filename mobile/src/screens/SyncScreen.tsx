import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '../sync/SyncContext';
import { getOutboxOperations } from '../db/database';
import { Badge, Button, Card, EmptyState, Screen, SectionHeader } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import { API_URL } from '../config';
import { formatDate, shortType } from '../utils/format';
import type { OutboxOperation } from '../types';

function operationReference(operation: OutboxOperation): string {
  const payload = operation.payload || {};
  const count = Array.isArray(payload.barcodes) ? payload.barcodes.length : 0;
  if (count > 0) {
    return `${count} QR code${count === 1 ? '' : 's'} in one group`;
  }
  if (typeof payload.barcode_value === 'string' && payload.barcode_value) {
    return payload.barcode_value;
  }
  if (payload.batch_id) return `Batch #${payload.batch_id}`;
  if (operation.entity_type) return shortType(operation.entity_type);
  return 'Field operation';
}

function statusLabel(status: OutboxOperation['status']): string {
  if (status === 'CONFLICT') return 'Needs review';
  if (status === 'FAILED') return 'Failed';
  if (status === 'APPLIED') return 'Synced';
  return 'Waiting';
}

function statusBadge(status: OutboxOperation['status']): string {
  if (status === 'CONFLICT') return 'DISPATCH_REJECTED';
  if (status === 'FAILED') return 'QC_FAILED';
  if (status === 'APPLIED') return 'APPLIED';
  return 'PENDING';
}

export default function SyncScreen() {
  const {
    online,
    syncing,
    lastSyncAt,
    pendingCount,
    conflictCount,
    error,
    sync,
    refreshLocal,
    retry,
    dismiss,
    clearError,
  } = useSync();
  const [operations, setOperations] = useState<OutboxOperation[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    await refreshLocal();
    setOperations(await getOutboxOperations(false, 100));
  }, [refreshLocal]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload queued rows when a sync finishes
    if (!syncing) void load();
  }, [syncing, lastSyncAt, load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await sync();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const retryOperation = async (operationId: string) => {
    setBusyId(operationId);
    try {
      await retry(operationId);
      await load();
    } catch (err: any) {
      Alert.alert('Retry failed', err?.message || 'The queued change could not be retried.');
    } finally {
      setBusyId(null);
    }
  };

  const dismissOperation = (operation: OutboxOperation) => {
    Alert.alert(
      'Discard this queued change?',
      'The change will be removed from this device and will not be sent to the server. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyId(operation.operation_id);
              try {
                await dismiss(operation.operation_id);
                await load();
              } catch (err: any) {
                Alert.alert('Could not discard', err?.message || 'Try again.');
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ]
    );
  };

  const unsynced = pendingCount + conflictCount;

  return (
    <Screen>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>SYNC CENTER</Text>
            <Text style={styles.title}>Your work, safely queued</Text>
            <Text style={styles.subtitle}>
              Everything is saved locally first. The app sends it automatically when a connection is available.
            </Text>
          </View>
          <View style={[styles.heroIcon, { backgroundColor: online ? colors.successSoft : colors.warningSoft }]}>
            <Ionicons
              name={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
              size={26}
              color={online ? colors.success : colors.warning}
            />
          </View>
        </View>

        <Card style={{ gap: spacing.md }}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: online ? colors.success : colors.warning }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>
                {online ? (syncing ? 'Syncing now...' : 'Connected') : 'Offline'}
              </Text>
              <Text style={styles.statusHint}>
                {lastSyncAt ? `Last sync ${formatDate(lastSyncAt)}` : 'No sync has completed on this device yet.'}
              </Text>
            </View>
            <Badge
              status={unsynced > 0 ? 'PENDING' : 'APPLIED'}
              label={unsynced > 0 ? `${unsynced} waiting` : 'All clear'}
            />
          </View>

          <View style={styles.countRow}>
            <View style={styles.countBox}>
              <Text style={styles.countValue}>{pendingCount}</Text>
              <Text style={styles.countLabel}>Waiting</Text>
            </View>
            <View style={styles.countBox}>
              <Text style={[styles.countValue, { color: conflictCount > 0 ? colors.danger : colors.text }]}>
                {conflictCount}
              </Text>
              <Text style={styles.countLabel}>Conflicts</Text>
            </View>
            <View style={styles.countBox}>
              <Text style={styles.countValue}>{operations.length}</Text>
              <Text style={styles.countLabel}>In queue</Text>
            </View>
          </View>

          <Button
            title={online ? 'Sync now' : 'Waiting for connection'}
            onPress={() => void refresh()}
            loading={syncing}
            disabled={!online}
            icon={<Ionicons name="sync-outline" size={18} color="#fff" />}
          />
          <Text style={styles.footerHint}>
            Keep the app installed until the queue is empty. Pending work survives app restarts and lost connections.
          </Text>
          {__DEV__ ? <Text style={styles.footerHint}>Server: {API_URL}</Text> : null}
        </Card>

        {error ? (
          <Pressable onPress={clearError} style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorTitle}>The last sync did not finish</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
            <Ionicons name="close-outline" size={18} color={colors.danger} />
          </Pressable>
        ) : null}

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Queue"
            subtitle="Conflicts stop automatically so that no field work is overwritten."
            right={<Badge status={conflictCount > 0 ? 'CONFLICT' : 'APPLIED'} label={`${operations.length} item${operations.length === 1 ? '' : 's'}`} />}
          />

          {operations.length === 0 ? (
            <EmptyState
              title="Nothing waiting to sync"
              message="New QC tests, dispatch confirmations, and dispatch orders will appear here until the server accepts them."
            />
          ) : (
            operations.map((operation) => {
              const canAct = operation.status === 'FAILED' || operation.status === 'CONFLICT';
              const busy = busyId === operation.operation_id;
              return (
                <View key={operation.operation_id} style={styles.operationCard}>
                  <View style={styles.operationHeader}>
                    <View style={styles.operationIcon}>
                      <Ionicons
                        name={operation.type.includes('DISPATCH') ? 'car-outline' : 'flask-outline'}
                        size={18}
                        color={operation.type.includes('DISPATCH') ? colors.success : colors.info}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.operationType} numberOfLines={1}>
                        {shortType(operation.type)}
                      </Text>
                      <Text style={styles.operationRef} numberOfLines={2}>
                        {operationReference(operation)}
                      </Text>
                    </View>
                    <Badge status={statusBadge(operation.status)} label={statusLabel(operation.status)} />
                  </View>

                  <View style={styles.operationMetaRow}>
                    <Text style={styles.operationMeta}>Saved {formatDate(operation.created_at)}</Text>
                    <Text style={styles.operationMeta}>Attempt {operation.attempts}</Text>
                  </View>

                  {operation.last_error ? (
                    <View style={styles.operationError}>
                      <Ionicons name="information-circle-outline" size={15} color={colors.danger} />
                      <Text style={styles.operationErrorText}>{operation.last_error}</Text>
                    </View>
                  ) : null}

                  {canAct ? (
                    <View style={styles.operationActions}>
                      <Button
                        title="Retry"
                        small
                        variant="secondary"
                        loading={busy}
                        disabled={!online || busy}
                        onPress={() => void retryOperation(operation.operation_id)}
                        style={{ flex: 1 }}
                      />
                      <Button
                        title="Discard"
                        small
                        variant="danger"
                        disabled={busy}
                        onPress={() => dismissOperation(operation)}
                        style={{ flex: 1 }}
                      />
                    </View>
                  ) : (
                    <Text style={styles.waitingHint}>
                      {online ? 'Ready to sync automatically.' : 'Will send when the connection returns.'}
                    </Text>
                  )}
                </View>
              );
            })
          )}
        </Card>

        <View style={styles.tipCard}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.tipTitle}>Offline-first by design</Text>
            <Text style={styles.tipText}>
              A QC or dispatch group is sent as one atomic operation. If the server rejects any code, the entire group is stopped and shown here for review.
            </Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.primary },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  statusHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  countRow: { flexDirection: 'row', gap: spacing.sm },
  countBox: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  countValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  countLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  footerHint: { fontSize: 11, color: colors.textFaint, textAlign: 'center', lineHeight: 16 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorTitle: { fontSize: 12, fontWeight: '800', color: colors.danger },
  errorText: { fontSize: 11, lineHeight: 16, color: colors.danger, marginTop: 2 },
  operationCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  operationHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  operationIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operationType: { fontSize: 13, fontWeight: '800', color: colors.text },
  operationRef: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  operationMetaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  operationMeta: { fontSize: 10, color: colors.textFaint },
  operationError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  operationErrorText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.danger },
  operationActions: { flexDirection: 'row', gap: spacing.sm },
  waitingHint: { fontSize: 11, color: colors.textFaint },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  tipTitle: { fontSize: 12, fontWeight: '800', color: colors.primaryDark },
  tipText: { fontSize: 11, lineHeight: 16, color: colors.primaryDark, marginTop: 2, opacity: 0.85 },
});
