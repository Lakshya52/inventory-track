import { useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { EllipsisVertical } from 'lucide-react-native';

export interface MoreMenuItem {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
}

interface MoreMenuProps {
  items: MoreMenuItem[];
}

/** Three-dot header menu. Dropdown is rendered as a transparent native modal. */
export function MoreMenu({ items }: MoreMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel="Open more menu"
        className="h-10 w-10 items-center justify-center rounded-full">
        <EllipsisVertical size={22} color="#14204b" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/20" onPress={() => setOpen(false)}>
          <View className="absolute right-4 top-16 w-48 rounded-xl bg-canvas p-2 shadow-lg">
            {items.map((item) => (
              <Pressable
                key={item.label}
                onPress={() => {
                  setOpen(false);
                  item.onPress();
                }}
                className="flex-row items-center gap-3 rounded-lg px-3 py-3">
                {item.icon}
                <Text className="text-sm font-lexend text-ink">{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
