import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { Button, Card, Screen, SectionHeader } from '../components/ui';
import { colors, spacing } from '../theme';

export default function LimitedAccessScreen() {
  const { session, logout } = useAuth();
  const { online, pendingCount, sync } = useSync();

  return (
    <Screen>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Card style={{ gap: spacing.md }}>
          <View style={styles.iconWrap}>
            <Ionicons name="phone-portrait-outline" size={28} color={colors.primary} />
          </View>
          <SectionHeader
            title="Field app access"
            subtitle={`Signed in as ${session?.user.name || 'user'} (${session?.user.role || '-'})`}
          />
          <Text style={styles.body}>
            The mobile field app is designed for QC and DISPATCH operators. Admin and
            reporting work is available in the main web dashboard.
          </Text>
          <View style={styles.infoBox}>
            <Ionicons name={online ? 'wifi-outline' : 'cloud-offline-outline'} size={16} color={online ? colors.success : colors.warning} />
            <Text style={styles.infoText}>
              {online ? 'Connected' : 'Offline'} · {pendingCount} queued change{pendingCount === 1 ? '' : 's'}
            </Text>
          </View>
          <Button title="Sync now" variant="secondary" onPress={() => void sync()} />
          <Button title="Sign out" variant="danger" onPress={() => void logout()} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingTop: spacing.xl },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { fontSize: 13, lineHeight: 20, color: colors.textMuted },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
  },
  infoText: { fontSize: 12, color: colors.textMuted },
});
