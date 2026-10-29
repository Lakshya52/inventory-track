import { useState } from 'react';
import { Camera, QrCode, X } from 'lucide-react-native';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { cx } from '@/lib/cx';

export function QRGraphic({ size = 180 }: { size?: number }) {
  return (
    <View className="flex-1 items-center justify-center">
      <QrCode size={size} color="#D9DEF2" strokeWidth={2} />
    </View>
  );
}

type ScannerCardProps = {
  /** Space kept below the warning text so the panel breathes at the bottom. */
  bottomPadding?: number;
  className?: string;
  onCodeScanned?: (code: string) => void;
};

export function ScannerCard({ bottomPadding = 32, className, onCodeScanned }: ScannerCardProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const [manual, setManual] = useState('');

  const startScanning = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(
          'Camera access required',
          'ProductScanning needs camera permission to scan QR codes. Please check your device settings.',
        );
        return;
      }
    }
    setActive(true);
  };

  const handleBarcodeScanned = (data: string) => {
    if (!data) return;
    if (onCodeScanned) {
      onCodeScanned(data);
    } else {
      Alert.alert('Scanned Code', data);
    }
    setActive(false);
  };

  return (
    <View
      className={cx('flex-1 rounded-t-[28px] bg-navbar px-5 pt-6', className)}
      style={{ paddingBottom: bottomPadding }}>
      {active && permission?.granted ? (
        <View className="w-full self-center overflow-hidden rounded-[22px] bg-black" style={{ aspectRatio: 1 }}>
          <CameraView
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'upc_a'],
            }}
            onBarcodeScanned={(result) => {
              if (result.data) {
                handleBarcodeScanned(result.data);
              }
            }}
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={() => setActive(false)}
            className="absolute top-3 right-3 h-8 w-8 items-center justify-center rounded-full bg-black/60">
            <X size={16} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : (
        <View className="w-full self-center rounded-[22px] bg-white p-6" style={{ aspectRatio: 1 }}>
          <QRGraphic />
        </View>
      )}

      {!active ? (
        <PrimaryButton
          label="Start Camera Scanning"
          icon={Camera}
          iconSize={22}
          labelClassName="text-[18px] leading-[24px]"
          className="mt-6 h-[58px] rounded-full"
          onPress={startScanning}
        />
      ) : (
        <PrimaryButton
          label="Close Camera"
          variant="outline"
          className="mt-4"
          onPress={() => setActive(false)}
        />
      )}

      {/* Manual Input Fallback */}
      <View className="mt-4 flex-row gap-2">
        <TextInput
          value={manual}
          onChangeText={setManual}
          placeholder="Or type / scan code manually..."
          placeholderTextColor="#8A98AC"
          className="h-10 flex-1 rounded-xl border border-[#D4E3FA] bg-white px-3 font-manrope-medium text-[12px] text-navy"
          onSubmitEditing={() => {
            if (manual.trim()) {
              handleBarcodeScanned(manual.trim());
              setManual('');
            }
          }}
        />
        <PrimaryButton
          label="Submit"
          size="md"
          disabled={!manual.trim()}
          onPress={() => {
            if (manual.trim()) {
              handleBarcodeScanned(manual.trim());
              setManual('');
            }
          }}
        />
      </View>

      <AppText
        variant="tiny"
        className="mx-auto mt-3 max-w-[270px] text-center text-[11px] leading-[15px] text-[#8A5A4A]">
        Camera access enables instant QR verification on device
      </AppText>
    </View>
  );
}
