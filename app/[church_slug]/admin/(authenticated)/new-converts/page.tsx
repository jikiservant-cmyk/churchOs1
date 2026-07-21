import { createAdminClient } from '@/lib/supabase/server';
import { UserPlus, Plus, MoreVertical, Pencil } from 'lucide-react';
import { addNewConvert, bulkAddNewConverts } from './actions';
import CSVUploader from '@/components/CSVUploader';
import SearchInput from '@/components/SearchInput';
import Link from 'next/link';
import { Suspense } from 'react';

import PaginatedConvertsList from '@/components/PaginatedConvertsList';

export default async function NewConvertsPage(props: {
  params: Promise<{ church_slug: string }>;
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const resolvedParams = await props.params;
  const searchParams = await props.searchParams;
  const Object_slug = resolvedParams.church_slug;
  const supabase = await createAdminClient();

  const { data: church } = await supabase
    .schema('church')
    .from('churches')
    .select('id')
    .eq('slug', Object_slug)
    .maybeSingle();

  let query = supabase
    .schema('church')
    .from('new_converts')
    .select('*')
    .eq('church_id', church?.id || '00000000-0000-0000-0000-000000000000');

  if (searchParams.q) {
    query = query.ilike('name', `%${searchParams.q}%`);
  }

  const { data: converts, error } = await query
    .order('id', { ascending: false })
    .limit(200);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New Converts</h1>
          <p className="text-slate-500 text-sm mt-1">Manage and follow up with new believers.</p>
        </div>
        <CSVUploader churchSlug={Object_slug} type="new-converts" onUpload={bulkAddNewConverts} />
      </div>

      {searchParams.error && (
        <div className="p-4 bg-red-50 text-[#FF4747] text-sm rounded-xl font-bold border border-red-100 mb-4">
          {searchParams.error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Converts List (Left Column) */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-[0_4px_24px_-8px_rgba(0,0,0,0.05)] border border-slate-100 overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 flex items-center gap-4">
            <Suspense fallback={<div className="flex-1 h-10 bg-slate-100 animate-pulse rounded-xl" />}>
              <SearchInput placeholder="Search converts by name..." />
            </Suspense>
            <button className="px-5 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-200 transition-colors">
              Filter
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            <PaginatedConvertsList 
              converts={converts || []} 
              churchSlug={Object_slug} 
              error={error} 
            />
          </div>
        </div>

        {/* Add Form (Right Column) */}
        <div className="bg-white rounded-xl shadow-[0_4px_24px_-8px_rgba(0,0,0,0.05)] border border-slate-100 p-6 h-fit">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-cyan-50 text-cyan-600 rounded-xl flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Add Convert</h2>
          </div>

          <form action={addNewConvert} className="space-y-4">
            <input type="hidden" name="churchSlug" value={Object_slug} />
            
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Full Name</label>
              <input 
                type="text" 
                name="name"
                required
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-cyan-500 focus:ring-0 outline-none transition-colors font-medium text-slate-900"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Contact Details</label>
              <textarea 
                name="contact"
                rows={3}
                placeholder="Phone number, email, or address"
                required
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-cyan-500 focus:ring-0 outline-none transition-colors font-medium text-slate-900 resize-none"
              />
            </div>

            <button 
              type="submit"
              className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors mt-4 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.1)]"
            >
              Save Details
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
