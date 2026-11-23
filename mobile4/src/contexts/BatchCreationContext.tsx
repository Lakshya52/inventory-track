import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import type { BatchGroupItem, CreateBatchResponse, Product } from '@/types/domain';

export interface BatchDraftItem {
  product: Product;
  quantity: number;
  packageQuantity: number;
  avgStandardQuantity: number;
  manufacturingDate: string;
  expiryDate: string;
  shelfLocationId: string | number | null;
  warehouseId: string | number | null;
}

interface BatchCreationContextValue {
  items: BatchDraftItem[];
  addProduct: (product: Product) => void;
  removeProduct: (productId: string | number) => void;
  updateItem: (productId: string | number, patch: Partial<BatchDraftItem>) => void;
  reset: () => void;
  toPayload: () => BatchGroupItem[];
  lastCreated: CreateBatchResponse | null;
  setLastCreated: (value: CreateBatchResponse | null) => void;
}

const BatchCreationContext = createContext<BatchCreationContextValue | null>(null);

const today = new Date();
const defaultMfg = today.toISOString().slice(0, 10);
const defaultExpiry = new Date(today.getTime() + 365 * 86400000).toISOString().slice(0, 10);

export function BatchCreationProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<BatchDraftItem[]>([]);
  const [lastCreated, setLastCreated] = useState<CreateBatchResponse | null>(null);

  const addProduct = useCallback((product: Product) => {
    setItems((current) => {
      if (current.some((item) => item.product.id === product.id)) return current;
      return [
        ...current,
        {
          product,
          quantity: 1,
          packageQuantity: 25,
          avgStandardQuantity: 25,
          manufacturingDate: defaultMfg,
          expiryDate: defaultExpiry,
          shelfLocationId: null,
          warehouseId: null,
        },
      ];
    });
  }, []);

  const removeProduct = useCallback((productId: string | number) => {
    setItems((current) => current.filter((item) => item.product.id !== productId));
  }, []);

  const updateItem = useCallback((productId: string | number, patch: Partial<BatchDraftItem>) => {
    setItems((current) => current.map((item) => (item.product.id === productId ? { ...item, ...patch } : item)));
  }, []);

  const reset = useCallback(() => setItems([]), []);

  const toPayload = useCallback(
    () =>
      items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        package_quantity: item.packageQuantity,
        uom: 'kg',
        shelf_location_id: item.shelfLocationId ?? 0,
        warehouse_id: item.warehouseId ?? 0,
        avg_standard_quantity: item.avgStandardQuantity,
        manufacturing_date: item.manufacturingDate,
        expiry_date: item.expiryDate,
      })),
    [items],
  );

  const value = useMemo(
    () => ({ items, addProduct, removeProduct, updateItem, reset, toPayload, lastCreated, setLastCreated }),
    [items, addProduct, removeProduct, updateItem, reset, toPayload, lastCreated],
  );

  return <BatchCreationContext.Provider value={value}>{children}</BatchCreationContext.Provider>;
}

export function useBatchCreation(): BatchCreationContextValue {
  const value = useContext(BatchCreationContext);
  if (!value) throw new Error('useBatchCreation must be used inside <BatchCreationProvider>.');
  return value;
}
