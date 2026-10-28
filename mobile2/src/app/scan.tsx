import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { X } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { ScannerCard } from '@/components/ui/scanner';

export default function ScanModalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-white">
      <StatusBar style="dark" />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}>
        <View className="w-full flex-1 self-center" style={{ maxWidth: 520 }}>
          <View className="px-6" style={{ paddingTop: Math.max(insets.top, 16) + 12 }}>
            <View className="items-end">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close scanner"
                onPress={() => router.back()}
                className="h-9 w-9 items-center justify-center rounded-full bg-[#AFE2F9]"
                style={({ pressed }) => (pressed ? { opacity: 0.75 } : undefined)}>
                <X size={18} color="#011A87" strokeWidth={2.4} />
              </Pressable>
            </View>

            <AppText variant="display" className="mt-8 text-center text-[30px] leading-[39px]">
              Scan &amp; View Details
            </AppText>
            <AppText
              variant="body"
              className="mt-2 self-center text-center text-[11px] leading-[16px]"
              style={{ maxWidth: 300 }}>
              Scan Any Qr Code That Is Already Printed And Pasted On A Product
            </AppText>
          </View>

          <ScannerCard className="mx-6 mt-7" bottomPadding={Math.max(insets.bottom, 16) + 24} />
        </View>
      </ScrollView>
    </View>
  );
}
