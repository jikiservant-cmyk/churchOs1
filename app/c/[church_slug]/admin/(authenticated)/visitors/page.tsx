import { createAdminClient } from '@/lib/supabase/server';
import { UserCheck, Plus } from 'lucide-react';
import { addVisitor, bulkAddVisitors } from './actions';
import CSVUploader from '@/components/CSVUploader';
import SearchInput from '@/components/SearchInput';
import Link from 'next/link';
import { Suspense } from 'react';

import PaginatedVisitorsList from '@/components/PaginatedVisitorsList';
import SubmitButton from '@/components/SubmitButton';

export default async function VisitorsPage(props: {
  params: Promise<{ church_slug: string }>;
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const resolvedParams = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createAdminClient();

  const { data: church, error: churchError } = await supabase
    .schema('church')
    .from('churches')
    .select('id')
    .eq('slug', resolvedParams.church_slug)
    .maybeSingle();

  let query = supabase
    .schema('church')
    .from('visitors')
    .select('*')
    .eq('church_id', church?.id || '00000000-0000-0000-0000-000000000000');

  if (searchParams.q) {
    query = query.ilike('full_name', `%${searchParams.q}%`);
  }

  const { data: visitors, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208]">Visitors</h1>
          <p className="text-[13px] text-[#9A7E65] mt-1.5 font-medium">Track and manage your church visitors.</p>
        </div>
        <CSVUploader churchSlug={resolvedParams.church_slug} type="visitors" onUpload={bulkAddVisitors} />
      </div>

      {searchParams.error && (
        <div className="p-4 bg-red-50 text-[#B5622A] text-sm rounded-xl font-bold border border-[rgba(181,98,42,0.1)] mb-6">
          {searchParams.error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#F0E6D3] rounded-2xl border border-[rgba(90,55,20,0.13)] overflow-hidden flex flex-col shadow-sm">
          <div className="p-5 border-b border-[rgba(90,55,20,0.08)] flex items-center gap-4">
            <Suspense fallback={<div className="flex-1 h-10 bg-[rgba(90,55,20,0.05)] animate-pulse rounded-xl" />}>
              <SearchInput placeholder="Search visitors by name..." />
            </Suspense>
            <button className="px-5 py-2.5 bg-[rgba(90,55,20,0.05)] text-[#1E1208] text-sm font-bold rounded-xl hover:bg-[rgba(90,55,20,0.1)] transition-colors">
              Filter
            </button>
          </div>

          <div className="flex-1">
            <PaginatedVisitorsList 
              visitors={visitors || []} 
              churchSlug={resolvedParams.church_slug} 
              error={error} 
            />
          </div>
        </div>

        <div className="bg-[#F0E6D3] rounded-2xl border border-[rgba(90,55,20,0.13)] p-6 h-fit shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[rgba(90,55,20,0.05)] text-[#B5622A] rounded-xl flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <h2 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208]">Add New Visitor</h2>
          </div>

          <form action={addVisitor} className="space-y-4">
            <input type="hidden" name="churchSlug" value={resolvedParams.church_slug} />

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Full Name *</label>
              <input 
                type="text" 
                name="fullName"
                required
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Phone Number</label>
                <input 
                  type="tel" 
                  name="phoneNumber"
                  className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Email</label>
                <input 
                  type="email" 
                  name="email"
                  className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
                />
              </div>
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

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Visitor Type</label>
              <select name="visitorType" className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208] appearance-none">
                <option value="first_time">First Time</option>
                <option value="returning">Returning</option>
                <option value="guest_from_another_church">Guest from Another Church</option>
                <option value="conference_guest">Conference Guest</option>
                <option value="traveling_member">Traveling Member</option>
                <option value="guest_preacher">Guest Preacher</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Source</label>
              <input 
                type="text" 
                name="source"
                placeholder="How did they hear about us?"
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Home Church Name</label>
              <input 
                type="text" 
                name="homeChurchName"
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Home Church City</label>
                <input 
                  type="text" 
                  name="homeChurchCity"
                  className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Home Church Pastor</label>
                <input 
                  type="text" 
                  name="homeChurchPastor"
                  className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Notes</label>
              <textarea 
                name="notes"
                rows={3}
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208] resize-none"
              ></textarea>
            </div>

            <SubmitButton
              className="w-full py-3.5 bg-[#2B1A0E] text-[#F5E6CE] rounded-xl text-sm font-bold hover:bg-[#3D2614] shadow-md transition-all mt-4 tracking-widest uppercase"
            >
              Save Visitor
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
