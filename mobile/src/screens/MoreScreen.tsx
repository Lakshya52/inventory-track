import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useSync } from '../sync/SyncContext';
import { Card, Screen, SectionHeader } from '../components/ui';
import { colors, spacing } from '../theme';

export default function MoreScreen() {
  const { session } = useAuth();
  const { pendingCount, conflictCount, online, sync, refreshLocal } = useSync();
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const role = session?.user.role;
  const refresh = async () => {
    setRefreshing(true);
    try { await sync(); await refreshLocal(); }
    catch (error) { console.warn('Could not refresh the More screen sync status.', error); }
    finally { setRefreshing(false); }
  };
  const links = [
    ...(role === 'ADMIN' ? [
      { title: 'Products', hint: 'Browse the product catalog', icon: 'flask-outline', href: '/products' },
      { title: 'Batch inventory', hint: 'Inspect batches and print QR labels', icon: 'albums-outline', href: '/(tabs)/batches' },
      { title: 'Production', hint: 'Batch fixes and QC handoff', icon: 'construct-outline', href: '/production' },
      { title: 'Reports & activity', hint: 'Export operational reports', icon: 'bar-chart-outline', href: '/(tabs)/reports' },
      { title: 'Inventory setup', hint: 'Products, users, clients, vendors and locations', icon: 'settings-outline', href: '/(tabs)/manage' },
    ] : role === 'QC' ? [
      { title: 'QC history', hint: 'Review submitted checks', icon: 'time-outline', href: '/(tabs)/history' },
    ] : [
      { title: 'Dispatch history', hint: 'Review completed dispatches', icon: 'time-outline', href: '/(tabs)/history' },
      { title: 'Packing lists', hint: 'Open a request from Orders', icon: 'clipboard-outline', href: '/(tabs)/orders' },
    ]),
    ...(role !== 'ADMIN' ? [{ title: 'Products', hint: 'Browse the product catalog', icon: 'flask-outline', href: '/products' }] : []),
    { title: 'Profile', hint: 'Account details, role and sign out', icon: 'person-circle-outline', href: '/profile' },
    { title: 'Settings', hint: 'Update your name and password', icon: 'settings-outline', href: '/settings' },
    { title: 'Sync center', hint: `${pendingCount} waiting · ${conflictCount} need review`, icon: 'sync-outline', href: '/sync' },
  ];
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <SectionHeader title="More" subtitle={`${role || ''} workspace · ${online ? 'online' : 'offline'}`} />
        <View style={styles.list}>
          {links.map((item) => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.hint}`} onPress={() => item.href.startsWith('/(tabs)/') ? router.navigate(item.href as any) : router.push(item.href as any)} style={({ pressed }) => pressed && styles.pressed}>
            <Card style={styles.card}>
              <View style={styles.icon}><Ionicons name={item.icon as any} size={21} color={colors.primary} /></View>
              <View style={styles.text}><Text style={styles.title}>{item.title}</Text><Text style={styles.hint}>{item.hint}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Card>
          </Pressable>)}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  list: { gap: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  title: { color: colors.text, fontWeight: '800', fontSize: 14 },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  pressed: { opacity: 0.75 },
});
