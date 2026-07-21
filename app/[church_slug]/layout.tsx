import { getChurchBySlug } from '@/lib/db';
import { notFound } from 'next/navigation';

export default async function ChurchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ church_slug: string }>;
}) {
  const resolvedParams = await params;
  if (resolvedParams.church_slug === '404' || resolvedParams.church_slug === '_not-found') {
    return <>{children}</>;
  }

  const church = await getChurchBySlug(resolvedParams.church_slug);

  if (!church) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {children}
    </div>
  );
}
