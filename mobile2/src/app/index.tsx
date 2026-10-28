import { Redirect } from 'expo-router';

import { roleHomeHref, useRole } from '@/context/role-context';

export default function IndexScreen() {
  const { user, isRestoring } = useRole();

  if (isRestoring) return null;

  return <Redirect href={user ? roleHomeHref[user.role] : '/login'} />;
}
