import { Text, View } from 'react-native';

export function KpiCard({
  value,
  label,
  highlight = false,
}: {
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <View
      className={`h-[84px] flex-1 justify-center rounded-2xl px-3 ${
        highlight ? 'bg-[#d9f3e8]' : 'bg-[#f1f2f8]'
      }`}>
      <Text className="text-[24px] font-lexend-bold text-brand">{value}</Text>
      <Text className="mt-1 text-[11px] font-lexend text-muted">{label}</Text>
    </View>
  );
}
