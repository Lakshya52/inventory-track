import { Check, X, type LucideIcon } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './app-text';
import { IconButton } from './buttons';

export type SheetOption = {
  label: string;
  description?: string;
  value: string;
};

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/35">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Close sheet" />
        <View
          className="w-full self-center rounded-t-[24px] bg-white px-5 pt-5"
          style={{ maxWidth: 520, paddingBottom: Math.max(insets.bottom, 16) + 16 }}>
          <View className="mb-1 flex-row items-center justify-between">
            {title ? (
              <AppText variant="h2" className="text-[18px]">
                {title}
              </AppText>
            ) : (
              <View />
            )}
            <IconButton icon={X} onPress={onClose} className="-mr-2 bg-canvas" />
          </View>
          <ScrollView
            className="mt-2"
            style={{ maxHeight: 520 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type OptionSheetProps = {
  visible: boolean;
  title: string;
  options: SheetOption[];
  value?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
};

export function OptionSheet({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: OptionSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            onPress={() => {
              onSelect(option.value);
              onClose();
            }}
            className="mb-2 flex-row items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3">
            <View className="flex-1 pr-3">
              <AppText
                variant="bodyDark"
                tone={active ? 'navy' : 'body'}
                className="font-manrope-semibold">
                {option.label}
              </AppText>
              {option.description ? (
                <AppText variant="caption" className="mt-0.5">
                  {option.description}
                </AppText>
              ) : null}
            </View>
            <View
              className={
                active
                  ? 'h-5 w-5 items-center justify-center rounded-full bg-navy'
                  : 'h-5 w-5 rounded-full border border-line-strong'
              }>
              {active ? <Check size={12} color="#FFFFFF" strokeWidth={3} /> : null}
            </View>
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

type SheetRowProps = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tone?: 'default' | 'danger';
};

export function SheetInfoRow({ icon: Icon, title, subtitle, tone = 'default' }: SheetRowProps) {
  return (
    <View className="mb-2 flex-row items-start gap-3 rounded-xl bg-canvas px-4 py-3">
      <Icon size={18} color={tone === 'danger' ? '#DD4350' : '#001A6E'} strokeWidth={1.9} />
      <View className="flex-1">
        <AppText
          variant="bodyDark"
          tone={tone === 'danger' ? 'danger' : 'body'}
          className="font-manrope-semibold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" className="mt-0.5">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
