import { Camera, QrCode } from 'lucide-react-native';
import { Alert, View } from 'react-native';

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
};

export function ScannerCard({ bottomPadding = 32, className }: ScannerCardProps) {
  const startScanning = () => {
    Alert.alert(
      'Camera access required',
      'ProductScanning needs camera permission to scan QR codes. Please check your device settings.',
    );
  };

  return (
    <View
      className={cx('flex-1 rounded-t-[28px] bg-navbar px-5 pt-6', className)}
      style={{ paddingBottom: bottomPadding }}>
      <View className="w-full self-center rounded-[22px] bg-white p-6" style={{ aspectRatio: 1 }}>
        <QRGraphic />
      </View>

      <PrimaryButton
        label="Start Scanning"
        icon={Camera}
        iconSize={22}
        labelClassName="text-[18px] leading-[24px]"
        className="mt-6 h-[58px] rounded-full"
        onPress={startScanning}
      />

      <AppText
        variant="tiny"
        className="mx-auto mt-3 max-w-[270px] text-center text-[11px] leading-[15px] text-[#8A5A4A]">
        This Feature Will Require Your Camera Permissions Please Check Your Settings
      </AppText>
    </View>
  );
}
