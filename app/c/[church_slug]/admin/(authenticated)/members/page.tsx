import { createAdminClient } from '@/lib/supabase/server';
import { Users, Plus, MoreVertical, Pencil } from 'lucide-react';
import { addMember, bulkAddMembers } from './actions';
import CSVUploader from '@/components/CSVUploader';
import SearchInput from '@/components/SearchInput';
import Link from 'next/link';
import { Suspense } from 'react';

import PaginatedMembersList from '@/components/PaginatedMembersList';
import SubmitButton from '@/components/SubmitButton';

export default async function MembersPage(props: {
  params: Promise<{ church_slug: string }>;
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const resolvedParams = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createAdminClient(); // Use admin client to bypass RLS for server components

  // Fetch church details first to get the ID for filtering
  const { data: church, error: churchError } = await supabase
    .schema('church')
    .from('churches')
    .select('id')
    .eq('slug', resolvedParams.church_slug)
    .maybeSingle();

  console.log('[Members Page] Slug from URL:', resolvedParams.church_slug);
  console.log('[Members Page] Church Data:', church, 'Church Error:', churchError);

  // Fetch members. 
  let query = supabase
    .schema('church')
    .from('members')
    .select('*')
    .eq('church_id', church?.id || '00000000-0000-0000-0000-000000000000');

  if (searchParams.q) {
    query = query.ilike('full_name', `%${searchParams.q}%`);
  }

  const { data: members, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);

  console.log('[Members Page] Members Data:', members, 'Members Error:', error);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208]">Members</h1>
          <p className="text-[13px] text-[#9A7E65] mt-1.5 font-medium">Manage your congregation, families, and ministries.</p>
        </div>
        <CSVUploader churchSlug={resolvedParams.church_slug} type="members" onUpload={bulkAddMembers} />
      </div>

      {searchParams.error && (
        <div className="p-4 bg-red-50 text-[#B5622A] text-sm rounded-xl font-bold border border-[rgba(181,98,42,0.1)] mb-6">
          {searchParams.error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Members List (Left Column) */}
        <div className="lg:col-span-2 bg-[#F0E6D3] rounded-2xl border border-[rgba(90,55,20,0.13)] overflow-hidden flex flex-col shadow-sm">
          <div className="p-5 border-b border-[rgba(90,55,20,0.08)] flex items-center gap-4">
            <Suspense fallback={<div className="flex-1 h-10 bg-[rgba(90,55,20,0.05)] animate-pulse rounded-xl" />}>
              <SearchInput placeholder="Search members by name..." />
            </Suspense>
            <button className="px-5 py-2.5 bg-[rgba(90,55,20,0.05)] text-[#1E1208] text-sm font-bold rounded-xl hover:bg-[rgba(90,55,20,0.1)] transition-colors">
              Filter
            </button>
          </div>

          <div className="flex-1">
            <PaginatedMembersList 
              members={members || []} 
              churchSlug={resolvedParams.church_slug} 
              error={error} 
            />
          </div>
        </div>

        {/* Add Member Form (Right Column) */}
        <div className="bg-[#F0E6D3] rounded-2xl border border-[rgba(90,55,20,0.13)] p-6 h-fit shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[rgba(90,55,20,0.05)] text-[#B5622A] rounded-xl flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <h2 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208]">Add New Member</h2>
          </div>

          <form action={addMember} className="space-y-4">
            <input type="hidden" name="churchSlug" value={resolvedParams.church_slug} />
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">First Name</label>
                <input 
                  type="text" 
                  name="firstName"
                  required
                  className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Last Name</label>
                <input 
                  type="text" 
                  name="lastName"
                  required
                  className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Phone Number</label>
              <input 
                type="tel" 
                name="phone"
                required
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Gender</label>
                <select name="gender" className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208] appearance-none">
                  <option value="">Select...</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Birthday</label>
                <input 
                  type="date" 
                  name="birthday"
                  className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
                />
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-2">
              <input type="checkbox" id="is_youth" name="isYouth" value="true" className="w-4 h-4 bg-[rgba(255,220,170,0.05)] border-[rgba(90,55,20,0.2)] text-[#B5622A] rounded focus:ring-[#B5622A] focus:ring-offset-0" />
              <label htmlFor="is_youth" className="text-sm font-bold text-[#9A7E65] cursor-pointer">Mark as Youth Member</label>
            </div>

            <SubmitButton
              className="w-full py-3.5 bg-[#2B1A0E] text-[#F5E6CE] rounded-xl text-sm font-bold hover:bg-[#3D2614] shadow-md transition-all mt-4 tracking-widest uppercase"
            >
              Save Member
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
