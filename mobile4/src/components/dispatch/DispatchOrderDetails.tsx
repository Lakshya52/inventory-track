import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Download } from 'lucide-react-native';

import { InfoRow, SectionHeading, ScreenTitle } from '@/components/common/Primitives';
import { useAsyncData } from '@/hooks/useAsyncData';
import { domainApi } from '@/services/domain';
import { downloadPackingListPdf } from '@/services/packingList';
import { WorkflowShell } from './WorkflowShell';

export function DispatchOrderDetails({ orderId }: { orderId: string }) {
  const { data, isLoading, isRefreshing, error, reload, refresh } = useAsyncData(() => domainApi.packingList(orderId), [orderId]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadPackingListPdf(orderId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not download the packing list.';
      setDownloadError(message);
    } finally {
      setDownloading(false);
    }
  };

  const rows = [
    { label: 'Client name', value: String(data?.client?.name ?? data?.client_name ?? '-') },
    { label: 'Order number', value: String(data?.order_number ?? '-') },
    { label: 'Quantity', value: `${data?.quantity ?? 0} Qty in Total` },
    { label: 'Transporter name', value: String(data?.driver_name ?? '-') },
    { label: 'Transporter mobile number', value: String(data?.driver_phone ?? '-') },
    { label: 'Transporter vehicle number', value: String(data?.vehicle_number ?? '-') },
    { label: 'Container number', value: String(data?.container_number ?? '-') },
    { label: 'Seal number', value: String(data?.seal_number ?? '-') },
  ];

  return (
    <WorkflowShell refreshing={isRefreshing} onRefresh={refresh}>
      <ScreenTitle>{`Orders\n#${data?.order_number ?? orderId}`}</ScreenTitle>

      <View className="mt-8">
        <SectionHeading>Order details</SectionHeading>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-6" color="#0b218c" />
      ) : error ? (
        <Text className="mt-6 text-center text-sm text-red-600" onPress={reload}>{error}</Text>
      ) : (
        <View className="mt-3 overflow-hidden rounded-2xl border border-[#e6e9f2] bg-canvas">
          <View className="bg-[#f1f2f8] px-4 py-3">
            <Text className="text-xs font-lexend-semibold text-ink">Dispatch order details</Text>
          </View>
          <View className="px-4 py-1">
            {rows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
          </View>
        </View>
      )}

      <Pressable
        onPress={onDownload}
        disabled={downloading}
        className={`mt-6 h-12 flex-row items-center justify-center gap-2 rounded-xl bg-[#0ba178] ${
          downloading ? 'opacity-70' : ''
        }`}>
        {downloading ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Download size={18} color="#ffffff" />
        )}
        <Text className="text-base font-lexend-semibold text-white">
          {downloading ? 'Preparing PDF...' : 'Download Packing List'}
        </Text>
      </Pressable>

      {downloadError ? (
        <Text className="mt-3 text-center text-sm text-red-600">{downloadError}</Text>
      ) : null}
    </WorkflowShell>
  );
}
