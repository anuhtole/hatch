'use client';

import { SWRConfig } from 'swr';
import { fetcher } from '@/lib/swr-config';
import { ChatProvider } from '@/lib/chat-context';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, dedupingInterval: 5000 }}>
      <ChatProvider>{children}</ChatProvider>
    </SWRConfig>
  );
}
