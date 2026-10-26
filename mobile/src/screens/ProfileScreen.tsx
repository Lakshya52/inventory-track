import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { Badge, Button, Card, KeyValue, Screen, SectionHeader } from '../components/ui';
import { APP_VERSION } from '../config';
import { colors, radius, spacing } from '../theme';
import { formatDate } from '../utils/format';

export default function ProfileScreen() {
  const router = useRouter();
  const { session, logout } = useAuth();
  const { online, syncing, pendingCount, conflictCount, lastSyncAt, sync } = useSync();
  const [loggingOut, setLoggingOut] = useState(false);

  const role = session?.user.role || '-';

  const doLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch (err: any) {
      Alert.alert('Could not sign out', err?.message || 'Try again after syncing your queued work.');
    } finally {
      setLoggingOut(false);
    }
  };

  const confirmLogout = () => {
    const queued = pendingCount + conflictCount;
    Alert.alert(
      'Sign out?',
      queued > 0
        ? `You have ${queued} unsynced change${queued === 1 ? '' : 's'}. Sign out only after the queue is empty, or the work will stay on this device.`
        : 'Your queued work is empty. This device will stop syncing until the next sign-in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void doLogout() },
      ]
    );
  };

  return (
    <Screen>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(session?.user.name || 'U').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>MY ACCOUNT</Text>
            <Text style={styles.title} numberOfLines={1}>{session?.user.name || 'Field user'}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{session?.user.email || '-'}</Text>
          </View>
        </View>

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Account"
            subtitle="Field access is controlled by your role."
            right={<Badge status="APPROVED" label={role} />}
          />
          <KeyValue label="Name" value={session?.user.name} />
          <KeyValue label="Email" value={session?.user.email} />
          <KeyValue label="Role" value={role} />
          <KeyValue label="App version" value={APP_VERSION} />
          <View style={styles.roleNote}>
            <Ionicons
              name={role === 'QC' ? 'flask-outline' : role === 'DISPATCH' ? 'car-outline' : 'information-circle-outline'}
              size={17}
              color={colors.primary}
            />
            <Text style={styles.roleNoteText}>
              {role === 'QC'
                ? 'You can scan groups of QR labels, record PASS or FAIL, and queue QR label prints on the web.'
                : role === 'DISPATCH'
                  ? 'You can raise dispatch orders and confirm groups of approved QR labels.'
                  : 'Admin work is available in the web dashboard. This app keeps sync and account tools available.'}
            </Text>
          </View>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Sync health"
            subtitle={online ? 'Connected and ready' : 'Offline — work stays on this device'}
            right={<Badge status={conflictCount > 0 ? 'CONFLICT' : 'APPLIED'} label={conflictCount > 0 ? 'Review needed' : 'Healthy'} />}
          />
          <View style={styles.syncRow}>
            <View style={styles.syncStat}>
              <Text style={styles.syncValue}>{pendingCount}</Text>
              <Text style={styles.syncLabel}>Waiting</Text>
            </View>
            <View style={styles.syncDivider} />
            <View style={styles.syncStat}>
              <Text style={[styles.syncValue, conflictCount > 0 && { color: colors.danger }]}>{conflictCount}</Text>
              <Text style={styles.syncLabel}>Conflicts</Text>
            </View>
            <View style={styles.syncDivider} />
            <View style={styles.syncStat}>
              <Text style={styles.syncValueSmall}>{lastSyncAt ? formatDate(lastSyncAt) : '-'}</Text>
              <Text style={styles.syncLabel}>Last sync</Text>
            </View>
          </View>
          <View style={styles.actionRow}>
            <Button
              title="Sync details"
              variant="secondary"
              onPress={() => router.push('/sync')}
              style={{ flex: 1 }}
            />
            <Button
              title={syncing ? 'Syncing' : 'Sync now'}
              loading={syncing}
              disabled={!online}
              onPress={() => void sync()}
              style={{ flex: 1 }}
            />
          </View>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Session"
            subtitle="Signing out keeps unsynced work only if the queue is empty."
          />
          <Button
            title="Sign out"
            variant="danger"
            loading={loggingOut}
            onPress={confirmLogout}
            icon={<Ionicons name="log-out-outline" size={18} color={colors.danger} />}
          />
          <Text style={styles.footerHint}>
            If the queue is not empty, sync first. The app refuses to sign out rather than risk losing field work.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.primary },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  roleNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  roleNoteText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.primaryDark },
  syncRow: { flexDirection: 'row', alignItems: 'center' },
  syncStat: { flex: 1, alignItems: 'center', gap: 2 },
  syncDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  syncValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  syncValueSmall: { fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'center' },
  syncLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  footerHint: { fontSize: 12, color: colors.textFaint, textAlign: 'center', lineHeight: 18 },
});
