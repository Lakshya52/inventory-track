import { useCallback, useState } from 'react';

/** Wraps a loader with pull-to-refresh state for `ScreenContainer`/`WorkflowShell`. */
export function usePullRefresh(onRefresh: () => Promise<unknown> | unknown) {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  return { refreshing, refresh };
}
