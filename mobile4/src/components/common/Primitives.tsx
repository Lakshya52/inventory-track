import type { ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';
import { ChevronRight, X } from 'lucide-react-native';

import { StyledSafeAreaView } from './StyledSafeAreaView';

export function SectionHeading({ children }: { children: ReactNode }) {
  return <Text className="text-base font-lexend-semibold text-brand">{children}</Text>;
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return <Text className="text-[28px] font-lexend-bold leading-[34px] text-brand">{children}</Text>;
}

export function ScreenSubtitle({ children }: { children: ReactNode }) {
  return <Text className="mt-2 text-sm font-lexend text-muted">{children}</Text>;
}

export function SearchField({ placeholder }: { placeholder: string }) {
  return (
    <TextInput
      placeholder={placeholder}
      className="h-12 rounded-xl bg-[#eef1f7] px-4 font-lexend text-ink"
    />
  );
}

export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-full bg-[#d9f3e8] px-2.5 py-1">
      <Text className="text-[10px] font-lexend-semibold text-[#0b8c6f]">{children}</Text>
    </View>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-3 border-b border-[#e6e9f2] py-2.5 last:border-b-0">
      <Text className="text-xs font-lexend text-muted">{label}</Text>
      <Text className="flex-1 text-right text-xs font-lexend-semibold text-ink">{value}</Text>
    </View>
  );
}

export function ScannerFrame() {
  return (
    <View className="mt-6 h-72 items-center justify-center rounded-[32px] bg-[#dfe3f4]">
      <View className="h-44 w-64">
        <View className="absolute left-0 top-0 h-12 w-12 rounded-tl-2xl border-l-4 border-t-4 border-brand" />
        <View className="absolute right-0 top-0 h-12 w-12 rounded-tr-2xl border-r-4 border-t-4 border-brand" />
        <View className="absolute bottom-0 left-0 h-12 w-12 rounded-bl-2xl border-b-4 border-l-4 border-brand" />
        <View className="absolute bottom-0 right-0 h-12 w-12 rounded-br-2xl border-b-4 border-r-4 border-brand" />
      </View>
    </View>
  );
}

export function TabSwitcher({
  active,
  onScan,
  onRecall,
}: {
  active: 'scan' | 'recall';
  onScan: () => void;
  onRecall: () => void;
}) {
  return (
    <View className="flex-row border-b border-line">
      <PressableTab label="Scan" active={active === 'scan'} onPress={onScan} />
      <PressableTab label="Recall" active={active === 'recall'} onPress={onRecall} />
    </View>
  );
}

import { Pressable } from 'react-native';

function PressableTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 items-center pb-3">
      <Text className={`text-sm font-lexend-semibold ${active ? 'text-brand' : 'text-muted'}`}>{label}</Text>
      {active ? <View className="mt-2 h-0.5 w-full bg-brand" /> : null}
    </Pressable>
  );
}

export function ChevronLink({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <View className="flex-row items-center justify-end gap-1">
      <Text className="text-xs font-lexend-semibold text-[#0b8c6f]">{label}</Text>
      <ChevronRight size={14} color="#0b8c6f" />
    </View>
  );
}

/** Minimal header for workflow screens: only a close (X) button. */
export function CloseHeader({ onClose }: { onClose: () => void }) {
  return (
    <StyledSafeAreaView edges={['top']} className="bg-canvas">
      <View className="flex-row justify-end px-5 py-3">
        <Pressable onPress={onClose} accessibilityLabel="Close" className="p-1">
          <X size={24} color="#14204b" />
        </Pressable>
      </View>
    </StyledSafeAreaView>
  );
}
