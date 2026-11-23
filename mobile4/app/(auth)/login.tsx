import { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Eye, EyeOff } from 'lucide-react-native';

import { AppButton } from '@/components/common/AppButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { ROLE_DASHBOARD_ROUTE } from '@/constants/routes';
import { useAuth } from '@/contexts/AuthContext';

/** One common login screen for ADMIN, QC and DISPATCH. */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email id and password.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const session = await signIn({ email: email.trim(), password });
      router.replace(ROLE_DASHBOARD_ROUTE[session.user.role]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer scroll>
      <View className="px-6 pt-20">
        <View className="flex-row items-center gap-3">
          <Image
            source={require('../../assets/logo.png')}
            className="h-14 w-14"
            resizeMode="contain"
            accessibilityLabel="ProductScanning logo"
          />
          <View>
            <Text className="text-2xl font-lexend-bold text-brand">Login</Text>
            <Text className="text-[10px] font-lexend text-muted">ProductScanning</Text>
          </View>
        </View>

        <Text className="mb-2 mt-8 text-sm font-lexend-medium text-ink">Email id</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Email id"
          className="h-12 rounded-xl bg-line px-4 font-lexend text-ink"
        />

        <Text className="mb-2 mt-5 text-sm font-lexend-medium text-ink">Password</Text>
        <View>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            placeholder="Password"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            className="h-12 rounded-xl bg-line pl-4 pr-12 font-lexend text-ink"
          />
          <Pressable
            onPress={() => setShowPassword((visible) => !visible)}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute',
              right: 12,
              top: 0,
              height: 48,
              width: 40,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {showPassword ? (
              <EyeOff size={20} color="#0b218c" />
            ) : (
              <Eye size={20} color="#65718c" />
            )}
          </Pressable>
        </View>

        <View className="mt-7">
          <AppButton onPress={handleLogin} disabled={busy}>
            {busy ? 'Signing in…' : 'Login'}
          </AppButton>
        </View>

        {error ? <Text className="mt-4 text-sm font-lexend text-red-600">{error}</Text> : null}
      </View>
    </ScreenContainer>
  );
}
