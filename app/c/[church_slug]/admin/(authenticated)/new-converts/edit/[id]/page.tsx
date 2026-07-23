import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { editNewConvert } from '../../actions';
import SubmitButton from '@/components/SubmitButton';

export default async function EditNewConvertPage(props: {
  params: Promise<{ church_slug: string; id: string }>;
}) {
  const resolvedParams = await props.params;
  const supabase = await createClient();

  // Fetch the specific convert
  const { data: convert, error } = await supabase
    .schema('church')
    .from('new_converts')
    .select('*')
    .eq('id', resolvedParams.id)
    .maybeSingle();

  if (!convert || error) {
    notFound();
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Edit New Convert</h1>
      </div>

      <div className="bg-white rounded-xl shadow-[0_4px_24px_-8px_rgba(0,0,0,0.05)] border border-slate-100 p-6 h-fit">
        <form action={editNewConvert} className="space-y-4">
          <input type="hidden" name="churchSlug" value={resolvedParams.church_slug} />
          <input type="hidden" name="convertId" value={resolvedParams.id} />
          
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Full Name</label>
            <input 
              type="text" 
              name="name"
              defaultValue={convert.name || ''}
              required
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-cyan-500 focus:ring-0 outline-none transition-colors font-medium text-slate-900"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Contact Details</label>
            <textarea 
              name="contact"
              rows={3}
              defaultValue={convert.contact || ''}
              placeholder="Phone number, email, or address"
              required
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-cyan-500 focus:ring-0 outline-none transition-colors font-medium text-slate-900 resize-none"
            />
          </div>

          <SubmitButton
            className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors mt-4 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.1)]"
            pendingText="Saving..."
          >
            Update Convert
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
