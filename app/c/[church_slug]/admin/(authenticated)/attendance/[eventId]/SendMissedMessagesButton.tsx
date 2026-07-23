'use client';

import { useState } from 'react';
import { sendMissedYouMessages } from '@/lib/attendance-actions';
import { Send, Loader2, MessageSquare, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function SendMissedMessagesButton({ eventId, churchId, churchSlug }: { eventId: string, churchId: string, churchSlug: string }) {
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState('Hello {first_name}! we missed you at church today. We pray you are well and hope to see you again next time. Blessings from your church family.');
  const [result, setResult] = useState<{ success?: boolean; count?: number; error?: string } | null>(null);
  const router = useRouter();

  const handleSend = async () => {
    setIsSending(true);
    setResult(null);
    try {
      const resp = await sendMissedYouMessages(churchId, churchSlug, eventId, message);
      setResult(resp);
      if (resp.success) {
        setIsEditing(false);
        router.refresh();
      }
    } catch (e: any) {
      setResult({ error: e.message || 'An error occurred' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 mt-8 w-full max-w-2xl mx-auto">
      {!isEditing ? (
        <button 
          onClick={() => setIsEditing(true)}
          className="flex items-center gap-2 bg-[#B5622A] text-white px-8 py-4 rounded-2xl font-bold text-[14px] uppercase tracking-widest hover:bg-[#944F22] transition-all shadow-lg active:scale-95"
        >
          <MessageSquare className="w-5 h-5" />
          Compose &quot;Missed You&quot; SMS
        </button>
      ) : (
        <div className="w-full bg-[#F0E6D3] p-6 rounded-2xl border border-[rgba(90,55,20,0.13)] shadow-sm animate-in zoom-in-95 duration-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[12px] font-bold text-[#7A4F30] uppercase tracking-wider flex items-center gap-2">
              <Send className="w-4 h-4" />
              Send to Absentees
            </h3>
            <button 
              onClick={() => setIsEditing(false)}
              className="text-[#9A7E65] hover:text-[#B5622A] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3">
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-[rgba(181,98,42,0.15)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-all resize-none text-[#1E1208] font-medium"
              placeholder="Enter your message..."
            />
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-[#9A7E65] font-medium">Tip: Use {"{first_name}"} to personalize</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 text-[12px] font-bold text-[#7A4F30] hover:bg-black/5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSend}
                  disabled={isSending || !message.trim()}
                  className="flex items-center gap-2 bg-[#B5622A] text-white px-5 py-2 rounded-xl font-bold text-[12px] uppercase tracking-widest hover:bg-[#944F22] transition-all disabled:opacity-50"
                >
                  {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Send Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {result?.success && (
        <p className="text-sm font-medium text-green-700 bg-green-50 px-6 py-3 rounded-xl border border-green-200 animate-in fade-in slide-in-from-top-2">
          Successfully sent {result.count} messages. 🚀
        </p>
      )}
      
      {result?.error && (
        <p className="text-sm font-medium text-red-700 bg-red-50 px-6 py-3 rounded-xl border border-red-200 animate-in fade-in slide-in-from-top-2">
          Failed to send: {result.error}
        </p>
      )}
    </div>
  );
}
