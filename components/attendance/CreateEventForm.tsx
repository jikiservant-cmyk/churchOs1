'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { createEvent } from '@/lib/attendance-actions';
import { useRouter } from 'next/navigation';

export function CreateEventForm({ churchId, churchSlug }: { churchId: string; churchSlug: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    
    try {
      const result = await createEvent(formData, churchId, churchSlug);
      if (result?.error) {
        setError(result.error);
      } else {
        // Form resets automatically or we can redirect
        (document.getElementById('create-event-form') as HTMLFormElement)?.reset();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#FAF7F0] p-6 rounded-2xl border border-[#E9E1D2] shadow-sm">
      <h2 className="text-sm font-bold text-[#1E1208] mb-4 flex items-center gap-2 uppercase tracking-wider">
         <Plus className="w-4 h-4 text-[#B5622A]" />
         Schedule New Service
      </h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs font-medium">
          Error: {error}
        </div>
      )}

      <form 
        id="create-event-form"
        action={handleSubmit}
        className="grid grid-cols-1 md:grid-cols-4 gap-4"
      >
        <div className="md:col-span-1">
          <label className="block text-[10px] font-bold text-[#9A7E65] uppercase tracking-widest mb-1.5 ml-1">Service Name</label>
          <input 
            name="name"
            required
            placeholder="Sunday Main Service"
            className="w-full px-4 py-2.5 bg-white border border-[#E9E1D2] rounded-xl text-[13px] focus:border-[#B5622A] outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-[#9A7E65] uppercase tracking-widest mb-1.5 ml-1">Type</label>
          <select 
            name="service_type"
            className="w-full px-4 py-2.5 bg-white border border-[#E9E1D2] rounded-xl text-[13px] focus:border-[#B5622A] outline-none"
          >
            <option value="sunday_service">Sunday Service</option>
            <option value="bible_study">Bible Study</option>
            <option value="prayer_meeting">Prayer Meeting</option>
            <option value="youth_service">Youth Service</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-[#9A7E65] uppercase tracking-widest mb-1.5 ml-1">Date & Time</label>
          <div className="flex gap-2">
            <input name="event_date" type="date" required defaultValue={new Date().toISOString().split('T')[0]} className="w-full px-3 py-2.5 bg-white border border-[#E9E1D2] rounded-xl text-[12px]" />
            <input name="start_time" type="time" required defaultValue="09:00" className="w-full px-3 py-2.5 bg-white border border-[#E9E1D2] rounded-xl text-[12px]" />
          </div>
        </div>
        <div className="flex items-end">
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-[#B5622A] text-white font-bold py-2.5 rounded-xl text-[12px] uppercase tracking-widest hover:bg-[#944F22] transition-colors shadow-md disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </form>
    </div>
  );
}
