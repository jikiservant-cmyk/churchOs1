import { getChurchBySlug } from '@/lib/db';
import GivingPortal from '@/components/GivingPortal';
import { notFound } from 'next/navigation';

export default async function GivingPage({
  params,
}: {
  params: Promise<{ church_slug: string }>;
}) {
  const resolvedParams = await params;
  
  if (resolvedParams.church_slug === '404' || resolvedParams.church_slug === '_not-found') {
    return null;
  }

  const church = await getChurchBySlug(resolvedParams.church_slug);

  if (!church) {
    notFound();
  }

  return <GivingPortal church={church} />;
}
