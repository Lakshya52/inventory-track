import { Users } from 'lucide-react-native';
import { useMemo } from 'react';

import { EntityScreen, type EntityService } from '@/screens/entity-screen';
import {
  createClient,
  deleteClient,
  fetchClients,
  updateClient,
  type ClientPayload,
} from '@/services/clients';

const fields = [
  { key: 'name', label: 'Client Name', placeholder: 'Enter client name' },
  { key: 'contact_person', label: 'Contact Person', placeholder: 'Enter contact person' },
  { key: 'email', label: 'Email ID', placeholder: 'Enter email address', keyboardType: 'email-address' as const },
  { key: 'phone', label: 'Phone', placeholder: 'Enter phone number', keyboardType: 'phone-pad' as const },
  { key: 'gst_number', label: 'GST Number', placeholder: 'Enter GST number (optional)' },
];

export default function ClientsScreen() {
  const service: EntityService = useMemo(
    () => ({
      fetchAll: () => fetchClients() as Promise<Record<string, unknown>[]>,

      create: async (values) => {
        const payload: ClientPayload = {
          name: values.name,
          contact_person: values.contact_person || undefined,
          email: values.email || undefined,
          phone: values.phone || undefined,
          gst_number: values.gst_number || undefined,
        };
        return createClient(payload);
      },

      update: async (id, values) => {
        const payload: ClientPayload = {
          name: values.name,
          contact_person: values.contact_person || undefined,
          email: values.email || undefined,
          phone: values.phone || undefined,
          gst_number: values.gst_number || undefined,
        };
        await updateClient(id, payload);
      },

      remove: (id) => deleteClient(id),
    }),
    [],
  );

  return (
    <EntityScreen
      title="Clients"
      subtitle="Manage or add clients"
      addLabel="Add Client"
      editLabel="Edit Client"
      fields={fields}
      icon={Users}
      tone="mint"
      service={service}
    />
  );
}
