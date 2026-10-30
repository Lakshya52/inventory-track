import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronRight,
  CircleHelp,
  LockKeyhole,
  LogOut,
  Pencil,
  RefreshCw,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import {
  BottomSheet,
  SheetInfoRow,
} from '@/components/ui/bottom-sheet';
import { IconButton, IconTile } from '@/components/ui/buttons';
import { FormSheet, type FormField } from '@/components/ui/form-sheet';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { roleProfiles, useRole } from '@/context/role-context';
import type { OfflineSyncOperation } from '@/services/offline-queue';
import { flushOfflineOperations, getOfflineOperations } from '@/services/offline-queue';
import type { Role } from '@/types';

const profileFields: FormField[] = [
  { key: 'name', label: 'Full Name', placeholder: 'Enter full name' },
  { key: 'email', label: 'Email id', placeholder: 'Enter email id', keyboardType: 'email-address' },
  { key: 'phone', label: 'Mobile Number', placeholder: 'Enter mobile number', keyboardType: 'phone-pad' },
];

const passwordFields: FormField[] = [
  { key: 'current', label: 'Current Password', secureTextEntry: true },
  { key: 'next', label: 'New Password', secureTextEntry: true },
  { key: 'confirm', label: 'Confirm Password', secureTextEntry: true },
];

const roleLabel: Record<Role, string> = {
  admin: 'ADMIN',
  qc: 'QC',
  dispatch: 'DISPATCH',
};

const subtitleByRole: Record<Role, string> = {
  admin: 'Admin Profile Management',
  qc: 'QC Profile Management',
  dispatch: 'Dispatch Profile Management',
};

type MenuRowProps = {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
};

function MenuRow({ icon, label, onPress, danger = false, last = false }: MenuRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={
        last
          ? 'h-[68px] flex-row items-center px-4'
          : 'h-[68px] flex-row items-center border-b border-[#F0F4FA] px-4'
      }
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}>
      <IconTile
        icon={icon}
        className={danger ? 'h-9 w-9 rounded-[8px] bg-[#FFF0F0]' : 'h-9 w-9 rounded-[8px] bg-[#EEF4FF]'}
        size={18}
        color={danger ? '#FF0000' : '#011A87'}
      />
      <AppText
        className={danger ? 'ml-3 flex-1 text-[13px]' : 'ml-3 flex-1 text-[13px] text-navy'}
        tone={danger ? 'danger' : 'navy'}
        style={{ fontFamily: danger ? 'Manrope_600SemiBold' : 'Manrope_500Medium' }}>
        {label}
      </AppText>
      {!danger ? <ChevronRight size={18} color="#011A87" strokeWidth={1.9} /> : null}
    </Pressable>
  );
}

function describeOfflineOperation(op: OfflineSyncOperation): string {
  if (op.type === 'LOADING_SESSION_SCAN') {
    return `Unit scan · QR ${op.payload?.qr_value ?? '—'}`;
  }
  if (op.type === 'LOADING_SESSION_START') {
    return `Loading session start · Order ${op.payload?.dispatch_order_id ?? '—'}`;
  }
  if (op.type === 'LOADING_SESSION_FINALISE') {
    return `Finalise · Seal ${op.payload?.seal_number ?? '—'} · ${op.payload?.outcome ?? ''}`;
  }
  return String(op.type);
}

export function SettingsScreen() {
  const router = useRouter();
  const { user, role, signOut, updateProfile } = useRole();
  const profile = user ?? roleProfiles[role];

  const [editOpen, setEditOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [offlineOps, setOfflineOps] = useState<OfflineSyncOperation[]>([]);
  const [syncing, setSyncing] = useState(false);

  const initialProfile = useMemo(
    () => ({
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
    }),
    [profile.name, profile.email, profile.phone],
  );

  const saveProfile = (values: Record<string, string>) => {
    const name = values.name?.trim() || profile.name;
    const initials = name
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    updateProfile({
      name,
      email: values.email?.trim() || profile.email,
      phone: values.phone?.trim() || profile.phone,
      initials,
    });
    setEditOpen(false);
  };

  const logout = async () => {
    await signOut();
    router.replace('/login');
  };

  const loadOfflineOps = useCallback(async () => {
    const operations = await getOfflineOperations();
    setOfflineOps(operations);
  }, []);

  useEffect(() => {
    // Load the persisted offline queue once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOfflineOps();
  }, [loadOfflineOps]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const stats = await flushOfflineOperations();
      await loadOfflineOps();
      Alert.alert(
        'Sync complete',
        stats.failed > 0
          ? `Synced ${stats.applied} operation(s). ${stats.failed} still need a connection.`
          : `Synced ${stats.applied} operation(s) to the server.`,
      );
    } catch {
      Alert.alert('Sync failed', 'Could not reach the server. Your offline scans will retry automatically.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Screen backgroundColor="#F6F9FF">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-6">
          <PageHeading title="Settings" subtitle={subtitleByRole[role]} />

          <View
            className="mt-9 items-center rounded-[12px] border border-[#EDF2FA] bg-white px-5 pb-5 pt-[22px]"
            style={{ boxShadow: '0px 10px 30px rgba(14, 42, 85, 0.06)' }}>
            <View className="items-center">
              <View className="h-[90px] w-[90px] items-center justify-center rounded-full bg-[#7BCBED]">
                <AppText
                  className="text-[30px] text-navy"
                  style={{ fontFamily: 'Manrope_700Bold' }}>
                  {profile.initials}
                </AppText>
              </View>
              <View className="-mt-[9px] rounded-full bg-navy px-2 py-[2px]">
                <AppText
                  className="text-[8px] leading-[11px] text-white"
                  style={{ fontFamily: 'Manrope_700Bold' }}>
                  {roleLabel[role]}
                </AppText>
              </View>
            </View>

            <AppText
              variant="h2"
              className="mt-4 text-[22px] leading-[30px]"
              style={{ fontFamily: 'Manrope_800ExtraBold' }}>
              {profile.name}
            </AppText>

            <View className="mt-0.5 flex-row items-center">
              <AppText variant="caption" className="text-[11px]">
                {profile.email}
              </AppText>
              <View className="mx-2 h-3 w-px bg-[#C5D2E3]" />
              <AppText variant="caption" className="text-[11px]">
                {profile.phone}
              </AppText>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => setEditOpen(true)}
              className="mt-5 h-[42px] flex-row items-center justify-center gap-2 rounded-full bg-navy px-6"
              style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}>
              <Pencil size={14} color="#FFFFFF" strokeWidth={2} />
              <AppText
                className="text-[11px] text-white"
                style={{ fontFamily: 'Manrope_600SemiBold' }}>
                Edit Profile
              </AppText>
            </Pressable>
          </View>

          {/* Offline sync status — what is queued and waiting to reach the server */}
          <View
            className="mt-[45px] overflow-hidden rounded-[12px] border border-[#EDF2FA] bg-white"
            style={{ boxShadow: '0px 8px 24px rgba(14, 42, 85, 0.05)' }}>
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <View className="h-9 w-9 items-center justify-center rounded-[8px] bg-[#EEF4FF]">
                {offlineOps.length > 0 ? <Wifi size={18} color="#011A87" /> : <WifiOff size={18} color="#011A87" />}
              </View>
              <View className="flex-1">
                <AppText className="text-[13px] text-navy" style={{ fontFamily: 'Manrope_500Medium' }}>
                  Offline sync
                </AppText>
                <AppText variant="caption" className="text-[10px] text-[#71829B]">
                  {offlineOps.length > 0
                    ? `${offlineOps.length} operation${offlineOps.length === 1 ? '' : 's'} waiting to sync`
                    : 'All caught up — nothing waiting to sync'}
                </AppText>
              </View>
            </View>

            {offlineOps.length > 0 ? (
              <View className="border-t border-[#F0F4FA] px-4 py-2">
                {offlineOps.slice(0, 5).map((op) => (
                  <View key={op.operation_id} className="flex-row items-start justify-between py-1.5">
                    <View className="flex-1 pr-3">
                      <AppText className="text-[11.5px] text-navy" style={{ fontFamily: 'Manrope_600SemiBold' }}>
                        {describeOfflineOperation(op)}
                      </AppText>
                      <AppText variant="tiny" className="mt-0.5 text-[9px] text-[#71829B]">
                        {op.operation_id}
                      </AppText>
                    </View>
                    <AppText variant="tiny" className="max-w-[45%] text-right text-[9px] text-[#71829B]">
                      {new Date(op.client_timestamp).toLocaleString()}
                    </AppText>
                  </View>
                ))}
                {offlineOps.length > 5 ? (
                  <AppText variant="tiny" className="py-1 text-[#71829B]">
                    + {offlineOps.length - 5} more pending operation{offlineOps.length - 5 === 1 ? '' : 's'}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            <View className="px-4 py-3">
              <Pressable
                accessibilityRole="button"
                disabled={syncing || offlineOps.length === 0}
                onPress={() => void syncNow()}
                className={`h-[38px] flex-row items-center justify-center gap-2 rounded-full ${
                  offlineOps.length === 0 ? 'bg-[#C7D4E6]' : 'bg-navy'
                }`}>
                <RefreshCw size={14} color="#FFFFFF" strokeWidth={2} />
                <AppText className="text-[11px] text-white" style={{ fontFamily: 'Manrope_600SemiBold' }}>
                  {syncing ? 'Syncing…' : 'Sync now'}
                </AppText>
              </Pressable>
            </View>
          </View>

          <View
            className="mt-0 overflow-hidden rounded-[12px] border border-[#EDF2FA] bg-white"
            style={{ boxShadow: '0px 8px 24px rgba(14, 42, 85, 0.05)' }}>
              {/* if user role is admin then only show company management */}
              {profile.role === 'admin' && (
                <MenuRow icon={Building2} label="Manage Company" onPress={() => setCompanyOpen(true)} />
              )}
              <MenuRow icon={LockKeyhole} label="Change Password" onPress={() => setPasswordOpen(true)} />
              <MenuRow icon={CircleHelp} label="Help & Support" onPress={() => setHelpOpen(true)} />
              <MenuRow icon={LogOut} label="Log out" onPress={logout} danger last />
            </View>
          </View>
      </ScrollView>

      <FormSheet
        visible={editOpen}
        title="Edit Profile"
        fields={profileFields}
        submitLabel="Save Changes"
        initialValues={initialProfile}
        onSubmit={saveProfile}
        onClose={() => setEditOpen(false)}
      />

      <FormSheet
        visible={passwordOpen}
        title="Change Password"
        fields={passwordFields}
        submitLabel="Update Password"
        onSubmit={() => {
          setPasswordOpen(false);
          Alert.alert('Password updated', 'Your password has been changed successfully.');
        }}
        onClose={() => setPasswordOpen(false)}
      />

{/* if user role is admin then only show company management */}
      {profile.role === 'admin' && (
        <BottomSheet visible={companyOpen} onClose={() => setCompanyOpen(false)} title="Manage Company">
          <SheetInfoRow icon={Building2} title={profile.company} subtitle="Registered organisation" />
          <SheetInfoRow icon={Building2} title="KLJ Industrial Estate" subtitle="Plot 24, Mumbai, Maharashtra" />
          <SheetInfoRow icon={Building2} title="GSTIN" subtitle="27AAACK1234L1ZX" />
          <SheetInfoRow icon={Building2} title="Workspace" subtitle="Admin · ProductScanning" />
          <IconButton
            icon={Pencil}
            onPress={() => {
              setCompanyOpen(false);
              setEditOpen(true);
            }}
            className="mt-2 h-11 w-full rounded-[10px] bg-navy"
            iconColor="#FFFFFF"
          />
        </BottomSheet>
      )}

      <BottomSheet visible={helpOpen} onClose={() => setHelpOpen(false)} title="Help & Support">
        <SheetInfoRow icon={CircleHelp} title="support@klj.com" subtitle="We reply within one business day" />
        <SheetInfoRow icon={CircleHelp} title="+91 96696 96969" subtitle="Monday to Saturday · 9 AM to 6 PM" />
        <SheetInfoRow icon={CircleHelp} title="Help centre" subtitle="Guides for QC, dispatch and inventory" />
      </BottomSheet>
    </Screen>
  );
}
