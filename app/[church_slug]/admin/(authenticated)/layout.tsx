import { getChurchBySlug } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import AdminSidebar from '@/components/AdminSidebar';

export default async function AdminLayout({ 
  children, 
  params 
}: { 
  children: React.ReactNode, 
  params: Promise<{ church_slug: string }> 
}) {
  const { church_slug } = await params;
  const church = await getChurchBySlug(church_slug);

  if (!church) {
    notFound();
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect(`/?error=Session Expired`);
  }

  // Role Check
  const { data: profile } = await supabase
    .from('admin_profiles')
    .select('role, tenant_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'pastor') {
    redirect(`/?error=Access Denied`);
  }

  // Church Mismatch Check - Simplified to just one potential redirect
  if (profile.tenant_id && church.id !== profile.tenant_id) {
    const { data: correctChurch } = await supabase
      .schema('church')
      .from('churches')
      .select('slug')
      .eq('id', profile.tenant_id)
      .maybeSingle();
      
    if (correctChurch?.slug && correctChurch.slug !== church_slug) {
      redirect(`/${correctChurch.slug}/admin`);
    } else {
       // If mismatch but no clear home, just render error instead of redirect loop
       return (
         <div className="min-h-screen bg-[#E4D5BC] flex items-center justify-center p-12 text-center">
            <div className="bg-[#F0E6D3] p-8 rounded-3xl border border-[#B5622A]/20 shadow-xl max-w-md">
               <h2 className="text-2xl font-bold text-[#1E1208] mb-4">Church Mismatch</h2>
               <p className="text-[#9A7E65]">You are not authorized to manage this church portal. Please contact support if this is an error.</p>
               <Link href="/" className="inline-block mt-6 px-6 py-2 bg-[#2B1A0E] text-[#F5E6CE] rounded-xl font-bold uppercase tracking-widest text-xs">Return Home</Link>
            </div>
         </div>
       );
    }
  }

  return (
    <div 
      style={{ fontFamily: "'Outfit', sans-serif" }}
      className="min-h-screen bg-[#E4D5BC] flex"
    >
      <AdminSidebar church={church} churchSlug={church_slug} />
      <main className="flex-1 overflow-y-auto px-6 py-8 md:px-12 md:py-10">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
