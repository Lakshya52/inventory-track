import { MapPin } from 'lucide-react-native';
import { useMemo } from 'react';

import { EntityScreen, type EntityService } from '@/screens/entity-screen';
import {
  createShelfLocation,
  deleteShelfLocation,
  fetchShelfLocations,
  updateShelfLocation,
  type ShelfLocationPayload,
} from '@/services/shelfLocations';

const fields = [
  { key: 'location_code', label: 'Location Code', placeholder: 'e.g. WH-A-R1-S2' },
  { key: 'warehouse', label: 'Warehouse', placeholder: 'Enter warehouse name (optional)' },
  { key: 'rack', label: 'Rack', placeholder: 'Enter rack identifier (optional)' },
  { key: 'shelf', label: 'Shelf', placeholder: 'Enter shelf identifier (optional)' },
  { key: 'description', label: 'Description', placeholder: 'Short description (optional)' },
];

export default function ShelvesScreen() {
  const service: EntityService = useMemo(
    () => ({
      fetchAll: () => fetchShelfLocations() as Promise<Record<string, unknown>[]>,

      create: async (values) => {
        const payload: ShelfLocationPayload = {
          location_code: values.location_code,
          warehouse: values.warehouse || undefined,
          rack: values.rack || undefined,
          shelf: values.shelf || undefined,
          description: values.description || undefined,
        };
        return createShelfLocation(payload);
      },

      update: async (id, values) => {
        const payload: ShelfLocationPayload = {
          location_code: values.location_code,
          warehouse: values.warehouse || undefined,
          rack: values.rack || undefined,
          shelf: values.shelf || undefined,
          description: values.description || undefined,
        };
        await updateShelfLocation(id, payload);
      },

      remove: (id) => deleteShelfLocation(id),
    }),
    [],
  );

  return (
    <EntityScreen
      title="Shelf Locations"
      subtitle="Manage shelf locations for storing products"
      addLabel="Add Shelf Location"
      editLabel="Edit Shelf Location"
      fields={fields}
      icon={MapPin}
      tone="purple"
      service={service}
    />
  );
}
