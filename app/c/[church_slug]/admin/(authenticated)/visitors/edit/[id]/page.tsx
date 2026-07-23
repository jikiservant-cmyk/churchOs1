import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { editVisitor } from '../../actions';
import SubmitButton from '@/components/SubmitButton';

export default async function EditVisitorPage(props: {
  params: Promise<{ church_slug: string; id: string }>;
}) {
  const resolvedParams = await props.params;
  const supabase = await createClient();

  const { data: visitor, error } = await supabase
    .schema('church')
    .from('visitors')
    .select('*')
    .eq('id', resolvedParams.id)
    .maybeSingle();

  if (!visitor || error) {
    notFound();
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208]">
          Edit Visitor
        </h1>
      </div>

      <div className="bg-[#F0E6D3] rounded-2xl border border-[rgba(90,55,20,0.13)] p-6 h-fit shadow-sm">
        <form action={editVisitor} className="space-y-4">
          <input type="hidden" name="churchSlug" value={resolvedParams.church_slug} />
          <input type="hidden" name="visitorId" value={resolvedParams.id} />
          
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Full Name *</label>
            <input 
              type="text" 
              name="fullName"
              defaultValue={visitor.full_name}
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
                defaultValue={visitor.phone_number || ''}
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Email</label>
              <input 
                type="email" 
                name="email"
                defaultValue={visitor.email || ''}
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Gender</label>
              <select name="gender" defaultValue={visitor.gender || ''} className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208] appearance-none">
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
                defaultValue={visitor.birthday || ''}
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Visitor Type</label>
            <select name="visitorType" defaultValue={visitor.visitor_type || 'first_time'} className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208] appearance-none">
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
              defaultValue={visitor.source || ''}
              className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Home Church Name</label>
            <input 
              type="text" 
              name="homeChurchName"
              defaultValue={visitor.home_church_name || ''}
              className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Home Church City</label>
              <input 
                type="text" 
                name="homeChurchCity"
                defaultValue={visitor.home_church_city || ''}
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Home Church Pastor</label>
              <input 
                type="text" 
                name="homeChurchPastor"
                defaultValue={visitor.home_church_pastor || ''}
                className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Notes</label>
            <textarea 
              name="notes"
              rows={3}
              defaultValue={visitor.notes || ''}
              className="w-full px-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-colors font-medium text-[#1E1208] resize-none"
            ></textarea>
          </div>

          <SubmitButton
              className="w-full py-3.5 bg-[#2B1A0E] text-[#F5E6CE] rounded-xl text-sm font-bold hover:bg-[#3D2614] shadow-md transition-all mt-4 tracking-widest uppercase"
            >
              Update Visitor
            </SubmitButton>
        </form>
      </div>
    </div>
  );
}
