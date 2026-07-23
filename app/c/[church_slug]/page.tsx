export const dynamic = "force-dynamic";

import { getChurchBySlug } from '@/lib/db';
import GivingPortal from '@/components/GivingPortal';
import { notFound } from 'next/navigation';

export default async function GivingPage({
  params,
}: {
  params: Promise<{ church_slug: string }>;
}) {
  const resolvedParams = await params;
  
  if (['404', '500', '_error', '_not-found', 'favicon.ico', 'api'].includes(resolvedParams.church_slug)) {
    return null;
  }

  const church = await getChurchBySlug(resolvedParams.church_slug);

  if (!church) {
    return null;
  }

  return <GivingPortal church={church} />;
}
