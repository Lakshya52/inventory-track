import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { domainApi } from '@/services/domain';
import type { Client, Product, ShelfLocation, Warehouse } from '@/types/domain';

interface AppDataContextValue {
  products: Product[];
  shelfLocations: ShelfLocation[];
  warehouses: Warehouse[];
  clients: Client[];
  warehouseByShelfLocation: Record<string | number, string | number>;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: PropsWithChildren) {
  const [products, setProducts] = useState<Product[]>([]);
  const [shelfLocations, setShelfLocations] = useState<ShelfLocation[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const [p, s, w, c] = await Promise.allSettled([
      domainApi.products(),
      domainApi.shelfLocations(),
      domainApi.warehouses(),
      domainApi.clients(),
    ]);
    if (p.status === 'fulfilled') setProducts(p.value);
    if (s.status === 'fulfilled') setShelfLocations(s.value);
    if (w.status === 'fulfilled') setWarehouses(w.value);
    if (c.status === 'fulfilled') setClients(c.value);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const warehouseByShelfLocation = useMemo(() => {
    const map: Record<string | number, string | number> = {};
    for (const warehouse of warehouses) {
      for (const rack of warehouse.racks ?? []) {
        for (const cell of rack.cells ?? []) {
          if (cell.shelf_location_id) map[cell.shelf_location_id] = warehouse.id;
        }
      }
    }
    return map;
  }, [warehouses]);

  const value = useMemo(
    () => ({ products, shelfLocations, warehouses, clients, warehouseByShelfLocation, isLoading, refresh }),
    [products, shelfLocations, warehouses, clients, warehouseByShelfLocation, isLoading, refresh],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside <AppDataProvider>.');
  return value;
}
