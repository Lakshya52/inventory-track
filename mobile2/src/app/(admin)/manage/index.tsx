import { useRouter, type Href } from 'expo-router';
import {
  Building2,
  MapPin,
  Package,
  ScanLine,
  UserRound,
  Users,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { ManagementTile } from '@/components/ui/cards';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';

export default function ManagementScreen() {
  const router = useRouter();
  const go = (href: Href) => router.push(href);

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-6">
          <PageHeading title="Management" subtitle="Overview" />

          <View className="mt-7 gap-[18px]">
            <View className="flex-row gap-4">
              <ManagementTile
                icon={Package}
                title="Products"
                subtitle="Add, edit, and remove products"
                tone="mint"
                onPress={() => go('/(admin)/manage/products')}
              />
              <ManagementTile
                icon={UserRound}
                title="Users"
                subtitle="Manage accounts and access"
                tone="blue"
                onPress={() => go('/(admin)/manage/users')}
              />
            </View>

            <View className="flex-row gap-4">
              <ManagementTile
                icon={MapPin}
                title="Shelf locations"
                subtitle="Organize where products are stored"
                tone="purple"
                onPress={() => go('/(admin)/manage/shelves')}
              />
              <ManagementTile
                icon={Building2}
                title="Vendors"
                subtitle="Manage your organization vendors"
                tone="peach"
                onPress={() => go('/(admin)/manage/vendors')}
              />
            </View>

            <View className="flex-row gap-4">
              <ManagementTile
                icon={Users}
                title="Clients"
                subtitle="Manage your organization clients"
                tone="mint"
                onPress={() => go('/(admin)/manage/clients')}
              />
              <ManagementTile
                icon={ScanLine}
                title="Scan QR"
                subtitle="Scan to view product information"
                tone="sky"
                onPress={() => router.push('/scan')}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
