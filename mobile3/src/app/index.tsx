import { Redirect } from 'expo-router';

import { roleHomeHref, useRole } from '@/context/role-context';

export default function IndexScreen() {
  const { user, isRestoring } = useRole();

  if (isRestoring) return null;
  if (user) return <Redirect href={roleHomeHref[user.role]} />;
  return <Redirect href="/login" />;
}
