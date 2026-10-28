import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { Field } from '@/components/ui/field';
import { roleHomeHref, useRole } from '@/context/role-context';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isRestoring, signIn } = useRole();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;

    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const role = await signIn(email, password);
      router.replace(roleHomeHref[role]);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isRestoring && user) {
    return <Redirect href={roleHomeHref[user.role]} />;
  }

  return (
    <View className="flex-1 bg-white">
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: Math.max(insets.top, 16) + 150,
            paddingBottom: Math.max(insets.bottom, 20) + 16,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View className="w-full self-center px-5" style={{ maxWidth: 362 }}>
            <AppText variant="display" className="text-center text-[31px] leading-[40px]">
              Login
            </AppText>

            <View className="mt-[48px]">
              <Field
                label="Email id"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                value={email}
                onChangeText={setEmail}
                editable={!submitting}
              />
              <Field
                label="Password"
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                editable={!submitting}
                returnKeyType="go"
                onSubmitEditing={submit}
              />
            </View>

            {error ? (
              <AppText tone="danger" className="mt-1 text-[11px] leading-4">
                {error}
              </AppText>
            ) : null}

            <PrimaryButton
              label={submitting ? 'Signing in...' : 'Login'}
              disabled={submitting}
              className={error ? 'mt-3 h-[48px] rounded-[6px]' : 'mt-[26px] h-[48px] rounded-[6px]'}
              onPress={submit}
            />

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/register')}
              className="mt-6 items-center"
              style={({ pressed }) => (pressed ? { opacity: 0.65 } : undefined)}>
              <AppText variant="link" className="text-[12px]">
                Create an account
              </AppText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
