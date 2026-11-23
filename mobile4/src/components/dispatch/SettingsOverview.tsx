import type { ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Bell, LogOut, ShieldCheck, User } from 'lucide-react-native';

import { AppHeader } from '@/components/layout/AppHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SectionHeading } from '@/components/common/Primitives';
import { ROLE_LABELS } from '@/constants/roles';
import { ROUTES } from '@/constants/routes';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePullRefresh } from '@/hooks/usePullRefresh';

function SettingRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-[#e6e9f2] py-3 last:border-b-0">
      {icon}
      <Text className="flex-1 text-sm font-lexend text-ink">{label}</Text>
      <Text className="text-xs font-lexend text-muted">{value}</Text>
    </View>
  );
}

export function SettingsOverview() {
  const { session, signOut } = useAuth();
  const { tenant, refresh } = useTenant();
  const { refreshing, refresh: onRefresh } = usePullRefresh(refresh);

  const handleLogout = () => {
    void signOut().then(() => router.replace(ROUTES.root));
  };

  return (
    <>
      <AppHeader title="Settings" showBack showMenu={false} />
      <ScreenContainer edges={[]} scroll refreshing={refreshing} onRefresh={onRefresh}>
        <View className="px-5 pt-6">
          <View className="flex-row items-center gap-4 rounded-2xl border border-[#e6e9f2] bg-canvas p-4 shadow-sm">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-nav-pill">
              <Text className="text-xl font-lexend-bold text-brand">
                {(session?.user.name ?? 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-base font-lexend-bold text-ink">{session?.user.name ?? 'User'}</Text>
              <Text className="mt-1 text-xs font-lexend text-muted">{session?.user.email ?? ''}</Text>
              <View className="mt-2 self-start rounded-full bg-[#d9f3e8] px-2 py-0.5">
                <Text className="text-[10px] font-lexend-semibold text-[#0b8c6f]">
                  {session ? ROLE_LABELS[session.user.role] : ''}
                </Text>
              </View>
            </View>
          </View>

          <View className="mt-7">
            <SectionHeading>Account</SectionHeading>
            <View className="mt-3 rounded-2xl border border-[#e6e9f2] bg-canvas px-4">
              <SettingRow icon={<User size={18} color="#65718c" />} label="User ID" value={session?.user.id ?? '-'} />
              <SettingRow icon={<ShieldCheck size={18} color="#65718c" />} label="Role" value={session ? ROLE_LABELS[session.user.role] : '-'} />
            </View>
          </View>

          <View className="mt-7">
            <SectionHeading>Tenant</SectionHeading>
            <View className="mt-3 rounded-2xl border border-[#e6e9f2] bg-canvas px-4">
              <SettingRow icon={<Bell size={18} color="#65718c" />} label="Organisation" value={tenant?.name ?? '-'} />
              <SettingRow icon={<ShieldCheck size={18} color="#65718c" />} label="Tenant ID" value={tenant?.id ?? '-'} />
            </View>
          </View>

          <Pressable
            onPress={handleLogout}
            className="mt-8 h-12 flex-row items-center justify-center gap-2 rounded-xl border border-[#d33b4a]">
            <LogOut size={18} color="#d33b4a" />
            <Text className="text-base font-lexend-semibold text-[#d33b4a]">Logout</Text>
          </Pressable>

          <Text className="mt-4 text-center text-[10px] font-lexend text-muted">ProductScanning · Mobile</Text>
          <View className="h-28" />
        </View>
      </ScreenContainer>
    </>
  );
}
