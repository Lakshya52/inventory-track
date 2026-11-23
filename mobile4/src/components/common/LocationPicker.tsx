import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';

import { useAppData } from '@/contexts/AppDataContext';

export function LocationPicker({
  value,
  onSelect,
}: {
  value: string | number | null;
  onSelect: (shelfLocationId: string | number, warehouseId: string | number) => void;
}) {
  const { shelfLocations, warehouseByShelfLocation, warehouses } = useAppData();
  const [open, setOpen] = useState(false);

  const selected = shelfLocations.find((item) => item.id === value);
  const defaultWarehouse = warehouses[0]?.id ?? 0;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="mt-1 h-10 justify-center rounded-lg border border-[#dfe3ee] bg-[#dfe1e7] px-3">
        <Text className="font-lexend text-sm text-ink">{selected?.location_code ?? 'Select location'}</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-canvas pt-12">
          <View className="flex-row items-center justify-between px-5 pb-3">
            <Text className="text-lg font-lexend-bold text-brand">Select Location</Text>
            <Pressable onPress={() => setOpen(false)}>
              <Text className="text-sm font-lexend-semibold text-brand">Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={shelfLocations}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onSelect(item.id, warehouseByShelfLocation[item.id] ?? defaultWarehouse);
                  setOpen(false);
                }}
                className="border-b border-[#e6e9f2] px-5 py-3">
                <Text className="text-sm font-lexend-semibold text-ink">{item.location_code}</Text>
                <Text className="text-[11px] font-lexend text-muted">
                  {item.warehouse ?? ''} {item.rack ? `· Rack ${item.rack}` : ''} {item.shelf ? `· Shelf ${item.shelf}` : ''}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </>
  );
}
