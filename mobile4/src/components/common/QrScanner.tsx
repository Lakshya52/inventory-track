import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

/** QR scanner with a manual-entry fallback (works on devices without camera). */
export function QrScanner({
  onScan,
  label = 'Enter QR value',
}: {
  onScan: (value: string) => void;
  label?: string;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const lastRef = useRef<{ value: string; at: number } | null>(null);
  const [cooldown, setCooldown] = useState(false);

  useEffect(() => {
    if (!permission) void requestPermission();
  }, [permission, requestPermission]);

  const handleBarcode = (data: string) => {
    const now = Date.now();
    if (lastRef.current?.value === data && now - lastRef.current.at < 2000) return;
    lastRef.current = { value: data, at: now };
    setCooldown(true);
    onScan(data);
    setTimeout(() => setCooldown(false), 2000);
  };

  if (!permission) {
    return <ActivityIndicator className="mt-10" color="#0b218c" />;
  }

  if (!permission.granted) {
    return (
      <View className="mt-6 items-center rounded-2xl border border-[#e6e9f2] bg-canvas p-4">
        <Text className="text-center text-sm text-muted">Camera permission is required to scan QR codes.</Text>
        <Pressable onPress={requestPermission} className="mt-3 rounded-xl bg-brand px-5 py-3">
          <Text className="text-sm font-lexend-semibold text-white">Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="mt-6">
      <View className="h-72 overflow-hidden rounded-[32px] bg-[#dfe3f4]">
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={cooldown ? undefined : (result) => handleBarcode(result.data)}
        />
      </View>

      <View className="mt-4 flex-row gap-2">
        <TextInput
          value={manual}
          onChangeText={setManual}
          placeholder={label}
          className="h-12 flex-1 rounded-xl border border-[#dfe3ee] bg-canvas px-4 font-lexend text-ink"
        />
        <Pressable
          onPress={() => {
            if (manual.trim()) {
              handleBarcode(manual.trim());
              setManual('');
            }
          }}
          className="h-12 items-center justify-center rounded-xl bg-brand px-5">
          <Text className="text-sm font-lexend-semibold text-white">Submit</Text>
        </Pressable>
      </View>
    </View>
  );
}
