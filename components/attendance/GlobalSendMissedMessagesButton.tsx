'use client';

import { useState } from 'react';
import { sendMissedYouMessages } from '@/lib/attendance-actions';
import { Send, Loader2, MessageSquare, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function GlobalSendMissedMessagesButton({ churchId, churchSlug }: { churchId: string, churchSlug: string }) {
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState('Hello {first_name}! we missed you at church today. We pray you are well and hope to see you again next time. Blessings from your church family.');
  const [result, setResult] = useState<{ success?: boolean; count?: number; error?: string } | null>(null);
  const router = useRouter();

  const handleSend = async () => {
    setIsSending(true);
    setResult(null);
    try {
      const resp = await sendMissedYouMessages(churchId, churchSlug, undefined, message);
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
    <div className="flex flex-col items-end gap-3 w-full max-w-md">
      {!isEditing ? (
        <button 
          onClick={() => setIsEditing(true)}
          className="flex items-center gap-2 bg-[#B5622A] text-white px-5 py-2.5 rounded-xl font-bold text-[12px] uppercase tracking-widest hover:bg-[#944F22] transition-all shadow-sm active:scale-95"
        >
          <MessageSquare className="w-4 h-4" />
          Message Flagged Absentees
        </button>
      ) : (
        <div className="w-full bg-[#F0E6D3] p-5 rounded-xl border border-[rgba(90,55,20,0.13)] shadow-sm animate-in slide-in-from-right-2 duration-200">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-[10px] font-bold text-[#7A4F30] uppercase tracking-widest flex items-center gap-2">
              <Send className="w-3.5 h-3.5" />
              Follow up with Flagged
            </h3>
            <button 
              onClick={() => setIsEditing(false)}
              className="text-[#9A7E65] hover:text-[#B5622A]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-[rgba(181,98,42,0.15)] rounded-lg text-xs focus:border-[#B5622A] outline-none transition-all resize-none text-[#1E1208] font-medium"
              placeholder="Enter follow-up message..."
            />
            <div className="flex justify-between items-center">
              <span className="text-[9px] text-[#9A7E65] font-medium italic">Supports {"{first_name}"}</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 text-[11px] font-bold text-[#7A4F30] hover:bg-black/5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSend}
                  disabled={isSending || !message.trim()}
                  className="flex items-center gap-2 bg-[#B5622A] text-white px-4 py-1.5 rounded-lg font-bold text-[11px] uppercase tracking-widest hover:bg-[#944F22] transition-all disabled:opacity-50"
                >
                  {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {result?.success && (
        <p className="text-[11px] font-bold text-green-700 bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">
          Sent {result.count} messages! 🚀
        </p>
      )}
      
      {result?.error && (
        <p className="text-[11px] font-bold text-red-700 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
          Error: {result.error}
        </p>
      )}
    </div>
  );
}
