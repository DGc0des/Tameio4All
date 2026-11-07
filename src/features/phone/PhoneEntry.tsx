import { useState } from 'react';
import { createDeviceApi } from '../../data/remote/device';
import { getSupabase } from '../../data/remote/supabase';
import { PhoneApp, type PhoneAppProps } from './PhoneApp';

/** Lazy-loaded entry: builds the real DeviceApi on the shared supabase client. Never imported by tests. */
export default function PhoneEntry(props: Omit<PhoneAppProps, 'api'>) {
  const [api] = useState(() => {
    const client = getSupabase(props.store);
    return client ? createDeviceApi(client) : null;
  });
  return <PhoneApp {...props} api={api} />;
}
