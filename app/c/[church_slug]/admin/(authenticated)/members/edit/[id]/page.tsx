import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { editMember } from '../../actions';
import SubmitButton from '@/components/SubmitButton';

export default async function EditMemberPage(props: {
  params: Promise<{ church_slug: string; id: string }>;
}) {
  const resolvedParams = await props.params;
  const supabase = await createClient();

  // Fetch the specific member
  const { data: member, error } = await supabase
    .schema('church')
    .from('members')
    .select('*')
    .eq('id', resolvedParams.id)
    .maybeSingle();

  if (!member || error) {
    notFound();
  }

  // Parse name assuming full_name was stitched, but let's just edit full fullName
  const fullNameParts = member.full_name?.split(' ') || [];
  const firstName = fullNameParts.shift() || '';
  const lastName = fullNameParts.join(' ') || '';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208]">
          Edit Member
        </h1>
      </div>

      <div className="bg-[#F0E6D3] rounded-2xl border border-[rgba(90,55,20,0.13)] p-6 h-fit shadow-sm">
        <form action={editMember} className="space-y-4">
          <input type="hidden" name="churchSlug" value={resolvedParams.church_slug} />
          <input type="hidden" name="memberId" value={resolvedParams.id} />
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">First Name</label>
              <input 
                type="text" 
                name="firstName"
                defaultValue={firstName}
                required
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Last Name</label>
              <input 
                type="text" 
                name="lastName"
                defaultValue={lastName}
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
              defaultValue={member.phone_number || ''}
              required
              className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Gender</label>
              <select name="gender" defaultValue={member.gender || ''} className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208] appearance-none">
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
                defaultValue={member.birthday || ''}
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-2">
            <input type="checkbox" id="is_youth" name="isYouth" value="true" defaultChecked={member.is_youth} className="w-4 h-4 bg-[rgba(255,220,170,0.05)] border-[rgba(90,55,20,0.2)] text-[#B5622A] rounded focus:ring-[#B5622A] focus:ring-offset-0" />
            <label htmlFor="is_youth" className="text-sm font-bold text-[#9A7E65] cursor-pointer">Mark as Youth Member</label>
          </div>

          <SubmitButton
            className="w-full py-3.5 bg-[#2B1A0E] text-[#F5E6CE] rounded-xl text-sm font-bold hover:bg-[#3D2614] shadow-md transition-all mt-4 tracking-widest uppercase"
          >
            Update Member
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
