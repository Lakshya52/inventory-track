import { Clock3, Package, Truck, UserRound } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useState } from 'react';

import { AppText } from '@/components/ui/app-text';
import { BottomSheet, SheetInfoRow } from '@/components/ui/bottom-sheet';
import { PrimaryButton } from '@/components/ui/buttons';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { dispatchOrders } from '@/data/mock';
import type { DispatchOrder } from '@/types';

export function DispatchOrdersScreen() {
  const [orders, setOrders] = useState<DispatchOrder[]>(dispatchOrders);
  const [selected, setSelected] = useState<DispatchOrder | null>(null);

  const approve = (id: string) => {
    setOrders((current) =>
      current.map((order) => (order.id === id ? { ...order, status: 'approved' } : order)),
    );
    setSelected((current) => (current?.id === id ? { ...current, status: 'approved' } : current));
  };

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-6">
          <PageHeading title="Dispatch Orders" subtitle="Overview" />

          <View className="mt-10 gap-[18px]">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onReview={() => setSelected(order)}
                onApprove={() => approve(order.id)}
              />
            ))}
          </View>
        </View>
      </ScrollView>

      <BottomSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `Review Order ${selected.order}` : 'Review Order'}>
        {selected ? (
          <>
            <View className="mb-3 flex-row items-center justify-between rounded-xl bg-canvas px-4 py-3">
              <AppText variant="bodyDark" className="font-manrope-semibold">
                Dispatch request
              </AppText>
              <StatusBadge
                status={selected.status === 'approved' ? 'approved' : 'pending'}
                label={selected.status === 'approved' ? 'Approved' : 'Pending'}
              />
            </View>
            <SheetInfoRow icon={UserRound} title="Customer" subtitle={selected.customer} />
            <SheetInfoRow icon={Package} title="Product" subtitle={`${selected.product} · ${selected.items}`} />
            <SheetInfoRow icon={Truck} title="Driver" subtitle={selected.driver} />
            <SheetInfoRow icon={Clock3} title="Raised on" subtitle={selected.raisedOn} />

            {selected.status === 'pending' ? (
              <PrimaryButton
                label="Approve Dispatch"
                className="mt-2"
                onPress={() => approve(selected.id)}
              />
            ) : (
              <View className="mt-2 rounded-[10px] bg-success-soft px-4 py-3">
                <AppText variant="bodyDark" tone="success" className="text-center font-manrope-semibold">
                  This dispatch request has been approved.
                </AppText>
              </View>
            )}
            <PrimaryButton
              label="Close"
              variant="outline"
              className="mt-2"
              onPress={() => setSelected(null)}
            />
          </>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

function OrderCard({
  order,
  onReview,
  onApprove,
}: {
  order: DispatchOrder;
  onReview: () => void;
  onApprove: () => void;
}) {
  const approved = order.status === 'approved';

  return (
    <View className="rounded-[12px] border border-[#D4E3FA] bg-white px-[14px] py-3.5">
      <View className="flex-row items-start">
        <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-[#E6E8FF]">
          <AppText
            className="text-[12px] text-navy"
            style={{ fontFamily: 'Manrope_700Bold' }}>
            OR
          </AppText>
        </View>

        <View className="flex-1">
          <AppText
            className="text-[16px] leading-[22px] text-navy"
            style={{ fontFamily: 'Manrope_800ExtraBold' }}>
            Order {order.order}
          </AppText>
          <AppText variant="tiny" className="mt-0.5 text-[9.5px]">
            Raised on - {order.raisedOn}
          </AppText>
        </View>

        <StatusBadge
          status={approved ? 'approved' : 'pending'}
          label={approved ? 'Approved' : 'Pending'}
        />
      </View>

      <View className="mt-3 flex-row">
        <View className="flex-1 pr-2">
          <AppText variant="tiny" className="text-[9px] uppercase tracking-wide">
            Customer
          </AppText>
          <AppText variant="bodyDark" className="mt-0.5 font-manrope-semibold text-[12px]">
            {order.customer}
          </AppText>

          <AppText variant="tiny" className="mt-2.5 text-[9px] uppercase tracking-wide">
            Product
          </AppText>
          <AppText variant="bodyDark" className="mt-0.5 font-manrope-semibold text-[12px]">
            {order.product}
          </AppText>
        </View>

        <View className="flex-1 pl-2">
          <AppText variant="tiny" className="text-[9px] uppercase tracking-wide">
            Items
          </AppText>
          <AppText variant="bodyDark" className="mt-0.5 font-manrope-semibold text-[12px]">
            {order.items}
          </AppText>

          <AppText variant="tiny" className="mt-2.5 text-[9px] uppercase tracking-wide">
            Driver
          </AppText>
          <AppText variant="bodyDark" className="mt-0.5 font-manrope-semibold text-[12px]">
            {order.driver}
          </AppText>
        </View>
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          onPress={onReview}
          className="h-[39px] flex-1 items-center justify-center rounded-[8px] border border-[#B8CCE8] bg-white"
          style={({ pressed }) => (pressed ? { opacity: 0.75 } : undefined)}>
          <AppText
            className="text-[12px] text-navy"
            style={{ fontFamily: 'Manrope_700Bold' }}>
            Review
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onApprove}
          disabled={approved}
          className={
            approved
              ? 'h-[39px] flex-1 items-center justify-center rounded-[8px] bg-success-soft'
              : 'h-[39px] flex-1 items-center justify-center rounded-[8px] bg-navy'
          }
          style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}>
          <AppText
            className={approved ? 'text-[12px]' : 'text-[12px] text-white'}
            tone={approved ? 'success' : 'white'}
            style={{ fontFamily: 'Manrope_700Bold' }}>
            {approved ? 'Approved' : 'Approve'}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
