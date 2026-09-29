import { useState } from 'react';
import { createOwnerApi } from '../../data/remote/owner';
import { createSupabase } from '../../data/remote/client';
import { OwnerApp, type OwnerAppProps } from './OwnerApp';

/** Lazy-loaded entry: the only place the real supabase client is created. Never imported by tests. */
export default function OwnerEntry(props: Omit<OwnerAppProps, 'api'>) {
  const [api] = useState(() => {
    const client = createSupabase(props.store);
    return client ? createOwnerApi(client) : null;
  });
  return <OwnerApp {...props} api={api} />;
}
