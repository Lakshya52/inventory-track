import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { roleHomeHref, useRole } from '@/context/role-context';
import { CONTENT_MAX_WIDTH } from '@/theme';

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

  if (isRestoring) return null;
  if (user) return <Redirect href={roleHomeHref[user.role]} />;

  return (
    <View className="flex-1 bg-canvas">
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 140,
            paddingBottom: insets.bottom + 24,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View className="w-full self-center px-8" style={{ maxWidth: CONTENT_MAX_WIDTH }}>
            <AppText variant="display" className="text-center">
              Login
            </AppText>

            <View className="mt-[72px]">
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
              <AppText tone="danger" className="mt-1 text-[12px]">
                {error}
              </AppText>
            ) : null}

            <PrimaryButton
              label={submitting ? 'Signing in...' : 'Login'}
              onPress={submit}
              disabled={submitting}
              className="mt-[64px]"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
