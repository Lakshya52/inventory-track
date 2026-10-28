import { useRouter } from 'expo-router';
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { PrimaryButton } from '@/components/ui/buttons';
import { Field } from '@/components/ui/field';
import { EmptyPanel, BackHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import {
  createUser,
  deleteUser,
  fetchAllUsers,
  updateUser,
  type AppUser,
  type UserRole,
} from '@/services/users';

// ─── Role colours ─────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin',
  QC: 'QC',
  DISPATCH: 'Dispatch',
};

const ROLE_COLORS: Record<UserRole, { bg: string; text: string }> = {
  ADMIN: { bg: '#E6E8FF', text: '#3B41C4' },
  QC: { bg: '#D4F4E4', text: '#1A7A4A' },
  DISPATCH: { bg: '#FFF0D4', text: '#A05E00' },
};

const ALL_ROLES: UserRole[] = ['ADMIN', 'QC', 'DISPATCH'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function UsersScreen() {
  const router = useRouter();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addRole, setAddRole] = useState<UserRole>('QC');
  const [addBusy, setAddBusy] = useState(false);

  // Edit form
  const [editTarget, setEditTarget] = useState<AppUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await fetchAllUsers();
      setUsers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Add ───────────────────────────────────────────────────────────────────
  const openAdd = () => {
    setAddName(''); setAddEmail(''); setAddPassword(''); setAddRole('QC');
    setAddOpen(true);
  };

  const handleAdd = async () => {
    if (!addName.trim() || !addEmail.trim() || !addPassword.trim()) {
      Alert.alert('Validation', 'Name, email and password are required.');
      return;
    }
    if (addPassword.length < 6) {
      Alert.alert('Validation', 'Password must be at least 6 characters.');
      return;
    }
    setAddBusy(true);
    try {
      await createUser({ name: addName.trim(), email: addEmail.trim(), password: addPassword, role: addRole });
      setAddOpen(false);
      load();
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setAddBusy(false);
    }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────
  const openEdit = (user: AppUser) => {
    setEditTarget(user);
    setEditName(user.name);
    setEditEmail(user.email);
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    if (!editName.trim() || !editEmail.trim()) {
      Alert.alert('Validation', 'Name and email are required.');
      return;
    }
    setEditBusy(true);
    try {
      await updateUser(editTarget.id, editTarget.role, {
        name: editName.trim(),
        email: editEmail.trim(),
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editTarget.id ? { ...u, name: editName.trim(), email: editEmail.trim() } : u,
        ),
      );
      setEditTarget(null);
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setEditBusy(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (user: AppUser) => {
    Alert.alert(
      'Delete User',
      `Are you sure you want to permanently delete "${user.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteUser(user.id, user.role);
              setUsers((prev) => prev.filter((u) => u.id !== user.id));
            } catch (err: unknown) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete user');
            }
          },
        },
      ],
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}>
        <View className="px-5 pt-5">
          <BackHeading
            title="User Management"
            subtitle="Manage users and their roles"
            onBack={() => router.back()}
          />

          <PrimaryButton
            label="Add New User"
            icon={Plus}
            className="mt-8 h-[50px] rounded-full"
            labelClassName="text-[16px]"
            onPress={openAdd}
          />

          <View className="mt-12">
            {loading ? (
              <View className="items-center py-10">
                <ActivityIndicator size="large" color="#001A6E" />
                <AppText variant="caption" className="mt-3">Loading…</AppText>
              </View>
            ) : error ? (
              <View className="items-center rounded-[12px] border border-line bg-white px-5 py-8">
                <AppText className="text-center text-[13px] text-danger">{error}</AppText>
                <Pressable
                  onPress={() => load()}
                  className="mt-4 rounded-full bg-navy px-5 py-2"
                  style={({ pressed }) => (pressed ? { opacity: 0.75 } : undefined)}>
                  <AppText className="text-[13px] text-white" style={{ fontFamily: 'Manrope_700Bold' }}>
                    Retry
                  </AppText>
                </Pressable>
              </View>
            ) : users.length === 0 ? (
              <EmptyPanel />
            ) : (
              <View className="gap-3">
                {users.map((user) => {
                  const colors = ROLE_COLORS[user.role];
                  return (
                    <View
                      key={`${user.role}-${user.id}`}
                      className="flex-row items-center gap-3 rounded-[12px] border border-line bg-white px-4 py-3.5">
                      {/* Avatar tile */}
                      <View className="h-9 w-9 items-center justify-center rounded-full bg-pastel-blue-icon">
                        <UserRound size={17} color="#001A6E" strokeWidth={1.8} />
                      </View>

                      {/* Info */}
                      <View className="flex-1">
                        <AppText
                          className="text-[13px] text-navy"
                          style={{ fontFamily: 'Manrope_700Bold' }}>
                          {user.name}
                        </AppText>
                        <AppText variant="caption" className="mt-0.5">
                          {user.email}
                        </AppText>
                        {/* Role badge */}
                        <View
                          className="mt-1.5 self-start rounded-full px-2.5 py-0.5"
                          style={{ backgroundColor: colors.bg }}>
                          <AppText
                            className="text-[10px]"
                            style={{ fontFamily: 'Manrope_700Bold', color: colors.text }}>
                            {ROLE_LABELS[user.role]}
                          </AppText>
                        </View>
                      </View>

                      {/* Edit */}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${user.name}`}
                        onPress={() => openEdit(user)}
                        className="h-8 w-8 items-center justify-center"
                        style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}>
                        <Pencil size={15} color="#001A6E" strokeWidth={1.8} />
                      </Pressable>

                      {/* Delete */}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${user.name}`}
                        onPress={() => handleDelete(user)}
                        className="h-8 w-8 items-center justify-center"
                        style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}>
                        <Trash2 size={16} color="#DD4350" strokeWidth={1.8} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* ── Add User Sheet ─────────────────────────────────────────────────── */}
      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add New User">
        <Field
          label="Full Name"
          placeholder="Enter full name"
          value={addName}
          onChangeText={setAddName}
        />
        <Field
          label="Email"
          placeholder="Enter email address"
          keyboardType="email-address"
          value={addEmail}
          onChangeText={setAddEmail}
        />
        <Field
          label="Password"
          placeholder="Min. 6 characters"
          secureTextEntry
          value={addPassword}
          onChangeText={setAddPassword}
        />

        {/* Role picker */}
        <AppText
          className="mb-1.5 mt-3 text-[12px] text-body"
          style={{ fontFamily: 'Manrope_600SemiBold' }}>
          Role
        </AppText>
        <View className="mb-3 flex-row gap-2">
          {ALL_ROLES.map((r) => {
            const active = addRole === r;
            const colors = ROLE_COLORS[r];
            return (
              <Pressable
                key={r}
                onPress={() => setAddRole(r)}
                className="flex-1 items-center rounded-full py-2"
                style={[
                  { backgroundColor: active ? colors.bg : '#F5F6FA' },
                  ({ pressed }) => (pressed ? { opacity: 0.75 } : undefined),
                ]}>
                <AppText
                  className="text-[12px]"
                  style={{
                    fontFamily: 'Manrope_700Bold',
                    color: active ? colors.text : '#8A98AC',
                  }}>
                  {ROLE_LABELS[r]}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <PrimaryButton
          label={addBusy ? 'Creating…' : 'Add User'}
          className="mt-2"
          onPress={handleAdd}
        />
      </BottomSheet>

      {/* ── Edit User Sheet ────────────────────────────────────────────────── */}
      <BottomSheet
        visible={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Edit User">
        <Field
          label="Full Name"
          placeholder="Enter full name"
          value={editName}
          onChangeText={setEditName}
        />
        <Field
          label="Email"
          placeholder="Enter email address"
          keyboardType="email-address"
          value={editEmail}
          onChangeText={setEditEmail}
        />

        {/* Role badge — read-only */}
        {editTarget ? (
          <View className="mb-3 mt-2 flex-row items-center gap-2 rounded-xl bg-canvas px-4 py-3">
            <AppText variant="caption">Role</AppText>
            <View
              className="ml-auto rounded-full px-3 py-0.5"
              style={{ backgroundColor: ROLE_COLORS[editTarget.role].bg }}>
              <AppText
                className="text-[11px]"
                style={{ fontFamily: 'Manrope_700Bold', color: ROLE_COLORS[editTarget.role].text }}>
                {ROLE_LABELS[editTarget.role]} · Cannot change
              </AppText>
            </View>
          </View>
        ) : null}

        <PrimaryButton
          label={editBusy ? 'Saving…' : 'Save Changes'}
          className="mt-2"
          onPress={handleEdit}
        />
      </BottomSheet>
    </Screen>
  );
}
