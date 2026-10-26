import React, { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, Field, Screen, SectionHeader } from '../components/ui';
import { colors, spacing } from '../theme';
import { APP_VERSION } from '../config';
import { useSync } from '../sync/SyncContext';

export default function SettingsScreen() {
  const { session, updateCurrentUser } = useAuth();
  const { online, pendingCount, conflictCount, sync, refreshLocal } = useSync();
  const router = useRouter();
  const [name, setName] = useState(session?.user.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError('');
    try {
      await sync();
      await refreshLocal();
      if (!online) return;
      const currentUser = await api.me();
      await updateCurrentUser({ name: currentUser.name, email: currentUser.email, role: currentUser.role });
      setName((currentName) => currentName === (session?.user.name || '') ? currentUser.name || '' : currentName);
    } catch (error: any) {
      setRefreshError(error?.message || 'Could not refresh your account details.');
    } finally {
      setRefreshing(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert('Name required', 'Enter your display name.'); return; }
    if (newPassword && !currentPassword) { Alert.alert('Current password required', 'Enter your current password before changing it.'); return; }
    setSaving(true);
    try {
      await api.profile.update({ name: name.trim(), ...(newPassword ? { currentPassword, newPassword } : {}) });
      const currentUser = await api.me();
      await updateCurrentUser({ name: currentUser.name, email: currentUser.email, role: currentUser.role });
      setCurrentPassword(''); setNewPassword('');
      Alert.alert('Settings saved', 'Your profile has been updated.');
    } catch (error: any) { Alert.alert('Could not save settings', error?.message || 'Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <SectionHeader title="Profile & settings" subtitle="Your account is shared across mobile and web." />
        {refreshError ? <Text style={styles.refreshError}>{refreshError}</Text> : null}
        <Card style={styles.info}>
          <Text style={styles.name}>{session?.user.name}</Text>
          <Text style={styles.meta}>{session?.user.email}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: online ? colors.success : colors.warning }]} />
            <Text style={styles.meta}>{online ? 'Connected to the application server' : 'Offline · profile changes need internet'}</Text>
          </View>
          <Text style={styles.meta}>{session?.user.role} · App {APP_VERSION}</Text>
          <Text style={styles.meta}>{pendingCount} waiting to sync · {conflictCount} need review</Text>
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="Personal details" subtitle="Change the name shown on your account." />
          <Field label="Display name" value={name} onChangeText={setName} autoCapitalize="words" />
          <SectionHeader title="Change password" subtitle="Leave both fields empty to keep your current password." />
          <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" />
          <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" />
          <Button title={online ? 'Save changes' : 'Connect to save changes'} loading={saving} disabled={!online} onPress={() => void save()} />
        </Card>

        <Button title="Sync and offline queue" variant="secondary" onPress={() => router.push('/sync')} />
        <Text style={styles.note}>To sign out, open Profile. Pending work is checked before the session is cleared.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  info: { gap: 8 },
  section: { gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  name: { color: colors.text, fontWeight: '800', fontSize: 18 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 18 },
  refreshError: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
