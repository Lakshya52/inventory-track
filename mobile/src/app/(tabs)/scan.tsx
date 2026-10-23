import React from 'react';
import { useAuth } from '../../auth/AuthContext';
import QCScanScreen from '../../screens/QCScanScreen';
import DispatchScreen from '../../screens/DispatchScreen';
import LimitedAccessScreen from '../../screens/LimitedAccessScreen';

export default function ScanRoute() {
  const { session } = useAuth();
  const role = session?.user.role;

  if (role === 'QC') return <QCScanScreen />;
  if (role === 'DISPATCH') return <DispatchScreen />;
  return <LimitedAccessScreen />;
}
