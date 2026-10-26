import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { Card, Screen, SectionHeader } from '../components/ui';
import { colors, spacing } from '../theme';
import LimitedAccessScreen from './LimitedAccessScreen';

const links = [
  { key: 'products', title: 'Products', subtitle: 'Catalog and import', icon: 'flask-outline', color: colors.primary },
  { key: 'users', title: 'Users', subtitle: 'Roles and access', icon: 'people-outline', color: colors.purple },
  { key: 'clients', title: 'Clients', subtitle: 'Dispatch destinations', icon: 'business-outline', color: colors.info },
  { key: 'vendors', title: 'Vendors', subtitle: 'Supplier records', icon: 'cube-outline', color: colors.warning },
  { key: 'masters', title: 'Grades', subtitle: 'Reusable product grades', icon: 'options-outline', color: colors.success },
  { key: 'bag-quantities', title: 'Bag quantities', subtitle: 'Packaging sizes and units', icon: 'scale-outline', color: colors.info },
  { key: 'locations', title: 'Locations', subtitle: 'Warehouse shelves', icon: 'location-outline', color: colors.danger },
];

export default function ManagementHubScreen() {
  const { session } = useAuth();
  const router = useRouter();
  if (session?.user.role !== 'ADMIN') return <LimitedAccessScreen />;
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Manage" subtitle="Common setup tasks, grouped for quick access" />
        <View style={styles.grid}>
          {links.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.subtitle}`}
              onPress={() => router.push(`/manage/${item.key}` as any)}
              style={({ pressed }) => [styles.cardPressable, pressed && styles.cardPressed]}
            >
              <Card style={styles.card}>
                <View style={[styles.icon, { backgroundColor: `${item.color}18` }]}>
                  <Ionicons name={item.icon as any} size={21} color={item.color} />
                </View>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.subtitle}>{item.subtitle}</Text>
                <Text style={[styles.open, { color: item.color }]}>Open →</Text>
              </Card>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cardPressable: { width: '48%', flexGrow: 1 },
  cardPressed: { opacity: 0.78 },
  card: { minHeight: 156, gap: 6 },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { color: colors.text, fontWeight: '800', fontSize: 15 },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  open: { fontWeight: '800', fontSize: 12, marginTop: 8 },
});
