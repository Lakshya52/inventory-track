import { useRouter } from 'expo-router';
import { Pencil, Plus, Trash2, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { IconTile, PrimaryButton } from '@/components/ui/buttons';
import { EmptyPanel, BackHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { FormSheet, type FormField } from '@/components/ui/form-sheet';
import { pastelClasses, type PastelTone } from '@/theme/pastel';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EntityItem = {
  id: string;
  /** Raw field values keyed by FormField.key, used to pre-fill the edit form. */
  rawValues: Record<string, string>;
  title: string;
  subtitle: string;
};

/** Optional service wiring for real CRUD. */
export type EntityService = {
  /** Load the full list. Returned items must include `id` + all field keys. */
  fetchAll: () => Promise<Record<string, unknown>[]>;
  /** Create a new record and return at minimum `{ id: string }`. */
  create: (values: Record<string, string>) => Promise<{ id: string }>;
  /** Update an existing record. */
  update: (id: string, values: Record<string, string>) => Promise<void>;
  /** Delete a record by id. */
  remove: (id: string) => Promise<void>;
};

export type EntityScreenProps = {
  title: string;
  subtitle: string;
  addLabel: string;
  editLabel?: string;
  fields: FormField[];
  icon: LucideIcon;
  tone: PastelTone;
  /** When provided, the screen loads data from the API and persists changes. */
  service?: EntityService;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map a raw API record to the display shape needed by the list. */
function rawToItem(raw: Record<string, unknown>, fields: FormField[]): EntityItem {
  const rawValues: Record<string, string> = {};
  for (const f of fields) {
    rawValues[f.key] = raw[f.key] != null ? String(raw[f.key]) : '';
  }

  const titleKey = fields[0].key;
  const title = rawValues[titleKey] || '(unnamed)';

  const subtitle = fields
    .slice(1)
    .map((f) => rawValues[f.key])
    .filter(Boolean)
    .join(' · ') || 'No additional details';

  return {
    id: String(raw.id ?? raw._id ?? Date.now()),
    rawValues,
    title,
    subtitle,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EntityScreen({
  title,
  subtitle,
  addLabel,
  editLabel,
  fields,
  icon,
  tone,
  service,
}: EntityScreenProps) {
  const router = useRouter();
  const palette = pastelClasses[tone];

  // ── State ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<EntityItem[]>([]);
  const [loading, setLoading] = useState(!!service);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form sheet state — null = closed, undefined = add mode, EntityItem = edit mode
  const [editing, setEditing] = useState<EntityItem | null | undefined>(null);
  const formOpen = editing !== null;

  // ── Load list ──────────────────────────────────────────────────────────────
  const loadItems = useCallback(
    async (isRefresh = false) => {
      if (!service) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const raw = await service.fetchAll();
        setItems(raw.map((r) => rawToItem(r, fields)));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [service, fields],
  );

  useEffect(() => {
    // This async loader updates state after the API request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadItems();
  }, [loadItems]);

  // ── Create ─────────────────────────────────────────────────────────────────
  const handleCreate = async (values: Record<string, string>) => {
    const titleValue = values[fields[0].key]?.trim();
    if (!titleValue) return;

    if (service) {
      try {
        await service.create(values);
        setEditing(null);
        // Full reload — avoids a brief duplicate-key state where the optimistic
        // item and the server-returned item share the same id.
        await loadItems();
      } catch (err: unknown) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to create');
      }

    } else {
      // Local-only mode
      setItems((prev) => [
        {
          id: `${Date.now()}`,
          rawValues: values,
          title: titleValue,
          subtitle: fields.slice(1).map((f) => values[f.key]?.trim()).filter(Boolean).join(' · ') || 'No additional details',
        },
        ...prev,
      ]);
      setEditing(null);
    }
  };

  // ── Edit ───────────────────────────────────────────────────────────────────
  const handleEdit = async (values: Record<string, string>) => {
    if (!editing) return;

    if (service) {
      try {
        await service.update(editing.id, values);
        setItems((prev) =>
          prev.map((it) => (it.id === editing.id ? rawToItem({ id: it.id, ...values }, fields) : it)),
        );
        setEditing(null);
      } catch (err: unknown) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update');
      }
    } else {
      setItems((prev) =>
        prev.map((it) =>
          it.id === editing.id ? rawToItem({ id: it.id, ...values }, fields) : it,
        ),
      );
      setEditing(null);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = (item: EntityItem) => {
    Alert.alert(
      `Delete ${title.replace(/s$/, '')}`,
      `Are you sure you want to delete "${item.title}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (service) {
              try {
                await service.remove(item.id);
              } catch (err: unknown) {
                Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete');
                return;
              }
            }
            setItems((prev) => prev.filter((it) => it.id !== item.id));
          },
        },
      ],
    );
  };

  // ── Form submit dispatcher ─────────────────────────────────────────────────
  const handleSubmit = (values: Record<string, string>) => {
    if (editing) {
      handleEdit(values);
    } else {
      handleCreate(values);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          service ? (
            <RefreshControl refreshing={refreshing} onRefresh={() => loadItems(true)} />
          ) : undefined
        }>
        <View className="px-5 pt-5">
          <BackHeading title={title} subtitle={subtitle} onBack={() => router.back()} />

          <PrimaryButton
            label={addLabel}
            icon={Plus}
            className="mt-8 h-[50px] rounded-full"
            labelClassName="text-[16px]"
            onPress={() => setEditing(undefined)}
          />

          <View className="mt-12">
            {loading ? (
              <View className="items-center py-10">
                <ActivityIndicator size="large" color="#001A6E" />
                <AppText variant="caption" className="mt-3">
                  Loading…
                </AppText>
              </View>
            ) : error ? (
              <View className="items-center rounded-[12px] border border-line bg-white px-5 py-8">
                <AppText className="text-center text-[13px] text-danger">{error}</AppText>
                <Pressable
                  onPress={() => loadItems()}
                  className="mt-4 rounded-full bg-navy px-5 py-2"
                  style={({ pressed }) => (pressed ? { opacity: 0.75 } : undefined)}>
                  <AppText className="text-[13px] text-white" style={{ fontFamily: 'Manrope_700Bold' }}>
                    Retry
                  </AppText>
                </Pressable>
              </View>
            ) : items.length === 0 ? (
              <EmptyPanel />
            ) : (
              <View className="gap-3">
                {items.map((item) => (
                  <View
                    key={item.id}
                    className="flex-row items-center gap-3 rounded-[12px] border border-line bg-white px-4 py-3.5">
                    <IconTile icon={icon} className={palette.icon} size={17} />

                    {/* Info */}
                    <View className="flex-1">
                      <AppText
                        className="text-[13px] text-navy"
                        style={{ fontFamily: 'Manrope_700Bold' }}>
                        {item.title}
                      </AppText>
                      <AppText variant="caption" className="mt-0.5">
                        {item.subtitle}
                      </AppText>
                    </View>

                    {/* Edit button */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${item.title}`}
                      onPress={() => setEditing(item)}
                      className="h-8 w-8 items-center justify-center"
                      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}>
                      <Pencil size={15} color="#001A6E" strokeWidth={1.8} />
                    </Pressable>

                    {/* Delete button */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${item.title}`}
                      onPress={() => handleDelete(item)}
                      className="h-8 w-8 items-center justify-center"
                      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}>
                      <Trash2 size={16} color="#DD4350" strokeWidth={1.8} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Add / Edit form sheet */}
      <FormSheet
        visible={formOpen}
        title={editing ? (editLabel ?? `Edit ${title.replace(/s$/, '')}`) : addLabel}
        fields={fields}
        submitLabel={editing ? 'Save Changes' : addLabel}
        initialValues={editing ? editing.rawValues : undefined}
        onSubmit={handleSubmit}
        onClose={() => setEditing(null)}
      />
    </Screen>
  );
}
