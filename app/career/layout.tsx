import { notFound } from 'next/navigation';
import { FEATURES } from '@/lib/feature-flags';
import CareerLayoutShell from './_shell';

// Server-component guard. When FEATURES.CAREER is false the route is
// completely unreachable (Next.js 404). Flipping the flag back to true
// restores the original client-side layout wrapper at ./_shell.
export default function CareerLayout({ children }: { children: React.ReactNode }) {
  if (!FEATURES.CAREER) notFound();
  return <CareerLayoutShell>{children}</CareerLayoutShell>;
}
