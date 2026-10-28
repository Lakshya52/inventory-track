import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import {
  Building2,
  ClipboardList,
  Clock3,
  FileClock,
  MapPin,
  Package,
  QrCode,
  ScanLine,
  Truck,
  UserRound,
  Users,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { BrandHeader } from '@/components/ui/brand';
import { QuickLink } from '@/components/ui/cards';
import { AppText } from '@/components/ui/app-text';
import { SectionLabel } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { useRole } from '@/context/role-context';

export default function AdminHomeScreen() {
  const router = useRouter();
  const { user } = useRole();

  const go = (href: Href) => router.push(href);

  return (
    <View className="flex-1 overflow-hidden bg-canvas">
      <ScrollView
        style={{ flex: 1 }}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
      <BrandHeader />

        <View className="px-5 pt-10">
          <AppText
            variant="display"
            className="text-[30px] leading-[38px]"
            style={{ fontFamily: 'Manrope_900ExtraBold' }}>
            Welcome, {user?.name.split(' ')[0] ?? 'UserName'}
          </AppText>
          <AppText variant="caption" className="mt-0.5 text-[11px]">
            Companysgiven@KLJ.Com
          </AppText>

          <View className="mt-12 flex-row flex-wrap justify-between gap-y-[9px]">
            <StatCard
              icon={Package}
              value="1200"
              label="Total Products"
              tone="mint"
              className="w-[48.2%]"
            />
            <StatCard
              icon={UserRound}
              value="120"
              label="Active Users"
              tone="blue"
              className="w-[48.2%]"
            />
            <StatCard
              icon={ClipboardList}
              value="12 / 1"
              label="Qc Passed / Failed"
              tone="purple"
              className="w-[48.2%]"
            />
            <StatCard
              icon={FileClock}
              value="5"
              label="Pending Requests"
              tone="peach"
              className="w-[48.2%]"
            />
          </View>

          <SectionLabel className="mt-[44px]">Quick Links</SectionLabel>

          <View className="mt-[10px] gap-[10px]">
            <View className="flex-row gap-[10px]">
              <QuickLink
                icon={Package}
                label="Products"
                tone="mint"
                onPress={() => go('/(admin)/manage/products')}
              />
              <QuickLink
                icon={MapPin}
                label="Shelf Locations"
                tone="blue"
                onPress={() => go('/(admin)/manage/shelves')}
              />
            </View>
            <View className="flex-row gap-[10px]">
              <QuickLink
                icon={Clock3}
                label="View Batches"
                tone="purple"
                onPress={() => go('/(admin)/manage/batches')}
              />
              <QuickLink
                icon={UserRound}
                label="Manage Users"
                tone="peach"
                onPress={() => go('/(admin)/manage/users')}
              />
            </View>
            <View className="flex-row gap-[10px]">
              <QuickLink
                icon={Users}
                label="Manage Clients"
                tone="mint"
                onPress={() => go('/(admin)/manage/clients')}
              />
              <QuickLink
                icon={Building2}
                label="Manage Vendors"
                tone="blue"
                onPress={() => go('/(admin)/manage/vendors')}
              />
            </View>
            <View className="flex-row gap-[10px]">
              <QuickLink
                icon={QrCode}
                label="View QR Codes"
                tone="purple"
                onPress={() => router.push('/scan')}
              />
              <QuickLink
                icon={Truck}
                label="View Dispatches"
                tone="peach"
                onPress={() => go('/(admin)/dispatches')}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

export const HomeIcon = ScanLine;
