export const dynamic = "force-dynamic";
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
  
  if (['404', '500', '_error', '_not-found', 'favicon.ico', 'api'].includes(resolvedParams.church_slug)) {
    return <div>Not Found</div>;
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
