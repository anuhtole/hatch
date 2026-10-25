'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Memory is now a modal opened from the sidebar; this route exists only
// to redirect anyone with the old /memory URL bookmarked.
export default function MemoryPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return null;
}
