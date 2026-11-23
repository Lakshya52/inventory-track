import { useLocalSearchParams } from 'expo-router';

import { BatchQrDetails, type QcStatus } from '@/components/dispatch/BatchQrDetails';

const STATUSES: QcStatus[] = ['NOT_MARKED', 'PASS', 'PRINTED', 'FAILED'];

export default function BatchQrDetailsScreen() {
  const { batchId, status } = useLocalSearchParams<{ batchId: string; status?: string }>();
  const qcStatus = STATUSES.find((item) => item === status) ?? 'PASS';

  return <BatchQrDetails jobId={batchId} status={qcStatus} />;
}
