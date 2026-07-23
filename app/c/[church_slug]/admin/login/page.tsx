import { getChurchBySlug } from '@/lib/db';
import LoginForm from '@/components/LoginForm';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ church_slug: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams || {};
  const church = await getChurchBySlug(resolvedParams.church_slug);
  
  // Normalize params
  const loginError = Array.isArray(resolvedSearchParams.error) ? resolvedSearchParams.error[0] : resolvedSearchParams.error;

  const displayChurch = church || {
    id: resolvedParams.church_slug,
    name: 'Church Admin',
    slug: resolvedParams.church_slug,
    themeColor: 'bg-blue-600',
    logoUrl: `https://picsum.photos/seed/${resolvedParams.church_slug}/200/200`
  };

  return (
    <LoginForm 
      church={displayChurch} 
      churchSlug={resolvedParams.church_slug} 
      error={loginError} 
    />
  );
}
