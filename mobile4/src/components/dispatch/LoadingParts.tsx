import { Pressable, Text, View } from 'react-native';
import { Download, Truck } from 'lucide-react-native';

import { InfoRow } from '@/components/common/Primitives';
import type { ActiveSession, DispatchOrder, ScanEvent } from '@/types/domain';

export function LoadingOrderCard({ order, onStart }: { order: DispatchOrder; onStart: () => void }) {
  const lines = (order.items ?? []).map((item) => ({
    name: String(item.product_name ?? item.grade_name ?? 'Product'),
    quantity: Number(item.quantity ?? 0),
  }));

  return (
    <View className="overflow-hidden rounded-2xl border border-[#bfe6d6] bg-canvas">
      <View className="bg-[#d9f3e8] px-4 py-2">
        <Text className="text-sm font-lexend-semibold text-ink">#{order.order_number}</Text>
      </View>
      <View className="flex-row gap-3 px-4 py-3">
        <View className="flex-1">
          <Text className="text-xs font-lexend-semibold text-brand">Party : {order.client_name ?? '-'}</Text>
          <View className="mt-2">
            <Text className="text-[10px] font-lexend text-muted">Transporter: {order.driver_name ?? '-'}</Text>
            <Text className="text-[10px] font-lexend text-muted">Vehicle No: {order.vehicle_number ?? '-'}</Text>
            <Text className="text-[10px] font-lexend text-muted">Container No: {order.container_number ?? '-'}</Text>
          </View>
        </View>
        <View>
          {lines.length > 0 ? (
            lines.map((line, index) => (
              <Text key={index} className="text-right text-[10px] font-lexend text-ink">
                {`${line.name} x${line.quantity}`}
              </Text>
            ))
          ) : (
            <Text className="text-right text-[10px] font-lexend text-ink">
              {String(order.product_name ?? 'Product')} x{order.quantity ?? 0}
            </Text>
          )}
        </View>
      </View>
      <View className="flex-row gap-3 px-4 pb-4">
        <Pressable className="h-10 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-brand">
          <Download size={15} color="#0b218c" />
          <Text className="text-xs font-lexend-semibold text-brand">Packing List</Text>
        </Pressable>
        <Pressable onPress={onStart} className="h-10 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-[#0ba178]">
          <Truck size={15} color="#ffffff" />
          <Text className="text-xs font-lexend-semibold text-white">Start Loading</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ScanProgressCard() {
  return (
    <View className="mt-4 rounded-2xl border border-[#e6e9f2] bg-[#f7f8fd] p-4">
      <View className="flex-row items-start justify-between">
        <View>
          <Text className="text-[10px] font-lexend-semibold text-muted">SCANNED UNITS</Text>
          <Text className="mt-1 text-xl font-lexend-bold text-ink">0 / 17</Text>
        </View>
        <Text className="text-lg font-lexend-bold text-brand">0%</Text>
      </View>
      <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#dfe3ee]">
        <View className="h-full w-0 rounded-full bg-[#0ba178]" />
      </View>
      <View className="mt-2 flex-row justify-between">
        <Text className="text-[10px] font-lexend text-muted">17 units remaining</Text>
        <Text className="text-[10px] font-lexend text-muted">Last sync 2:34:53 PM</Text>
      </View>
      <Text className="mt-1 text-right text-[10px] font-lexend-semibold text-[#0ba178]">● Live</Text>
    </View>
  );
}

export function ShipmentDetailsCard({ session }: { session?: ActiveSession | null }) {
  const rows = [
    { label: 'Product', value: String(session?.product_name ?? '-') },
    { label: 'Batch', value: String(session?.batch_number ?? '-') },
    { label: 'Grade', value: String(session?.grade_name ?? '-') },
    { label: 'Order', value: String(session?.order_number ?? '-') },
    { label: 'Started', value: String(session?.started_at ?? '').slice(0, 16).replace('T', ' ') },
  ];
  return (
    <View className="mt-4 rounded-2xl border border-[#e6e9f2] bg-canvas px-4 py-2">
      <Text className="py-2 text-sm font-lexend-semibold text-brand">Shipment details</Text>
      {rows.map((row) => (
        <InfoRow key={row.label} label={row.label} value={row.value} />
      ))}
    </View>
  );
}

export function RecentScansCard({ events = [] }: { events?: ScanEvent[] }) {
  return (
    <View className="mt-4 min-h-40 rounded-2xl border border-[#e6e9f2] bg-canvas p-4">
      <Text className="text-sm font-lexend-semibold text-brand">Recent Scans</Text>
      {events.slice(0, 10).map((event) => (
        <View key={event.id} className="mt-2 border-b border-[#e6e9f2] pb-2 last:border-b-0">
          <Text className="text-xs font-lexend-semibold text-ink">{event.qr_value}</Text>
          <Text className="text-[10px] font-lexend text-muted">
            {event.result} · {String(event.scanned_at).slice(0, 16).replace('T', ' ')}
          </Text>
        </View>
      ))}
      {events.length === 0 ? <Text className="mt-3 text-xs font-lexend text-muted">No scans yet.</Text> : null}
    </View>
  );
}
