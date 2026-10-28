import { Building2 } from 'lucide-react-native';
import { useMemo } from 'react';

import { EntityScreen, type EntityService } from '@/screens/entity-screen';
import {
  createVendor,
  deleteVendor,
  fetchVendors,
  updateVendor,
  type VendorPayload,
} from '@/services/vendors';

const fields = [
  { key: 'name', label: 'Vendor Name', placeholder: 'Enter vendor name' },
  { key: 'contact_person', label: 'Contact Person', placeholder: 'Enter contact person' },
  { key: 'email', label: 'Email ID', placeholder: 'Enter email address', keyboardType: 'email-address' as const },
  { key: 'phone', label: 'Phone', placeholder: 'Enter phone number', keyboardType: 'phone-pad' as const },
  { key: 'gst_number', label: 'GST Number', placeholder: 'Enter GST number (optional)' },
];

export default function VendorsScreen() {
  const service: EntityService = useMemo(
    () => ({
      fetchAll: () => fetchVendors() as Promise<Record<string, unknown>[]>,

      create: async (values) => {
        const payload: VendorPayload = {
          name: values.name,
          contact_person: values.contact_person || undefined,
          email: values.email || undefined,
          phone: values.phone || undefined,
          gst_number: values.gst_number || undefined,
        };
        return createVendor(payload);
      },

      update: async (id, values) => {
        const payload: VendorPayload = {
          name: values.name,
          contact_person: values.contact_person || undefined,
          email: values.email || undefined,
          phone: values.phone || undefined,
          gst_number: values.gst_number || undefined,
        };
        await updateVendor(id, payload);
      },

      remove: (id) => deleteVendor(id),
    }),
    [],
  );

  return (
    <EntityScreen
      title="Vendors"
      subtitle="Manage or add vendors"
      addLabel="Add Vendor"
      editLabel="Edit Vendor"
      fields={fields}
      icon={Building2}
      tone="peach"
      service={service}
    />
  );
}
