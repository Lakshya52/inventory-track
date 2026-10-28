import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { Field } from '@/components/ui/field';

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-white">
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: Math.max(insets.top, 16) + 70,
            paddingBottom: Math.max(insets.bottom, 20) + 24,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View className="w-full self-center px-5" style={{ maxWidth: 362 }}>
            <AppText
              variant="display"
              className="text-center text-[27px] leading-[36px]">
              Registration
            </AppText>

            <View className="mt-[40px]">
              <Field label="Company Name" />
              <Field label="Name" />
              <Field label="Email id" keyboardType="email-address" autoCapitalize="none" />
              <Field label="Mobile Number" keyboardType="phone-pad" />
              <Field label="Create Password" secureTextEntry />
            </View>

            <PrimaryButton
              label="Sign up"
              className="mt-4 h-[48px] rounded-[6px]"
              onPress={() => router.replace('/login')}
            />

            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/login')}
              className="mt-6 items-center"
              style={({ pressed }) => (pressed ? { opacity: 0.65 } : undefined)}>
              <AppText variant="link" className="text-[12px]">
                Already have an account? Login
              </AppText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
