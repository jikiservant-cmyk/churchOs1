'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { Send, AlertCircle, Loader2, CheckCircle2, User, UserCheck, UserPlus, Search, CheckSquare, Square } from 'lucide-react';
import { normalizeUgPhone } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function BroadcastComposer({ members, churchId }: { 
  members: { id: string, full_name: string, phone_number: string, source: string, gender?: string, is_youth?: boolean }[], 
  churchId: string 
}) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [audience, setAudience] = useState<'all' | 'men' | 'women' | 'youth' | 'new_converts'>('all');
  const [recipientLimit, setRecipientLimit] = useState<number | ''>('');
  const [progress, setProgress] = useState({ active: false, total: 0, sent: 0, failed: 0 });
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  
  // New states for individual selection
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isListExpanded, setIsListExpanded] = useState(false);
  
  const sendingRef = useRef(false);
  const router = useRouter();

  // Filter members based on group audience first
  const groupFilteredMembers = useMemo(() => {
    return members.filter(m => {
      if (audience === 'all') return true;
      if (audience === 'men') return m.source === 'member' && m.gender === 'male';
      if (audience === 'women') return m.source === 'member' && m.gender === 'female';
      if (audience === 'youth') return m.source === 'member' && m.is_youth === true;
      if (audience === 'new_converts') return m.source === 'new_convert';
      return true;
    });
  }, [members, audience]);

  // Sync selectedIds when group audience changes
  useEffect(() => {
    setSelectedIds(new Set(groupFilteredMembers.map(m => m.id)));
  }, [groupFilteredMembers]);

  // Filter members based on search query
  const searchableMembers = useMemo(() => {
    if (!searchQuery.trim()) return groupFilteredMembers;
    const query = searchQuery.toLowerCase();
    return groupFilteredMembers.filter(m => 
      m.full_name.toLowerCase().includes(query) || 
      m.phone_number.includes(query)
    );
  }, [groupFilteredMembers, searchQuery]);

  // Final members to be sent to (intersection of group filter and manual selection)
  const finalMembers = useMemo(() => {
    const selected = groupFilteredMembers.filter(m => selectedIds.has(m.id));
    return recipientLimit && typeof recipientLimit === 'number' && recipientLimit > 0 
      ? selected.slice(0, recipientLimit) 
      : selected;
  }, [groupFilteredMembers, selectedIds, recipientLimit]);

  const toggleMember = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleAllVisible = () => {
    const newSelected = new Set(selectedIds);
    const allVisibleSelected = searchableMembers.every(m => selectedIds.has(m.id));
    
    if (allVisibleSelected) {
      searchableMembers.forEach(m => newSelected.delete(m.id));
    } else {
      searchableMembers.forEach(m => newSelected.add(m.id));
    }
    setSelectedIds(newSelected);
  };

  const audienceLabels = {
    all: 'All Contacts',
    men: 'Men Only',
    women: 'Women Only',
    youth: 'Youth Only',
    new_converts: 'New Converts'
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || finalMembers.length === 0 || sendingRef.current) return;
    
    sendingRef.current = true;
    setIsSending(true);
    setStatus(null);
    setProgress({ active: true, total: finalMembers.length, sent: 0, failed: 0 });
    
    try {
      const response = await fetch('/api/sms/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          churchId,
          recipients: finalMembers
            .map(m => ({
              full_name: m.full_name,
              phone_number: normalizeUgPhone(m.phone_number)
            }))
            .filter(m => m.phone_number !== null)
        })
      });

      if (!response.ok) throw new Error('Failed to start broadcast');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';
      let stopReading = false;

      while (!stopReading) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const update = JSON.parse(line);

            if (update.type === 'success') {
            setProgress(p => ({ ...p, sent: p.sent + 1 }));
          } else if (update.type === 'error') {
            setProgress(p => ({ ...p, failed: p.failed + 1 }));
            console.error(`Broadcast error for ${update.recipient}:`, update.error);
          } else if (update.type === 'halt') {
              setStatus({ type: 'error', message: `Halted: ${update.reason}` });
              stopReading = true;
              break;
            }
          } catch (e) {
            console.warn("Error parsing stream chunk", e);
          }
        }
      }

      if (!stopReading) {
        setStatus({ type: 'success', message: 'Broadcast Complete! 🚀' });
        setMessage('');
        router.refresh();
      }
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || "Failed to complete broadcast." });
    } finally {
      setIsSending(false);
      setProgress(p => ({ ...p, active: false }));
      sendingRef.current = false;
    }
  };

  return (
    <div className="bg-[#F0E6D3] rounded-2xl border border-[rgba(90,55,20,0.13)] p-8 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h2 style={{ fontFamily: "'Playfair Display', serif" }} className="text-xl font-bold text-[#1E1208] flex items-center gap-2">
          <Send className="w-5 h-5 text-[#B5622A]" />
          New Broadcast
        </h2>
      </div>

      {status && (
        <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 ${
          status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 
          status.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {status.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <p className="text-sm font-bold">{status.message}</p>
        </div>
      )}

      <form onSubmit={handleSend} className="space-y-6">
        <div className="bg-[rgba(181,98,42,0.05)] border border-[rgba(181,98,42,0.12)] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#B5622A] shrink-0 mt-0.5" />
              <div>
                <h4 className="text-[13px] font-bold text-[#7A4F30] uppercase tracking-wider">Recipient Audience</h4>
                <p className="text-[12px] text-[#9A7E65] mt-1 font-medium leading-relaxed">
                  Sending to <span className="text-[#B5622A] font-bold">{finalMembers.length}</span> selected recipients from <span className="font-bold">{audienceLabels[audience]}</span>.
                </p>
              </div>
            </div>
            <div className="shrink-0 w-full sm:w-auto flex items-center gap-3">
              <div className="flex flex-col">
                <label className="text-[9px] font-bold text-[#C8B89A] uppercase tracking-widest mb-1">Limit (optional)</label>
                <input 
                  type="number"
                  placeholder="All"
                  value={recipientLimit}
                  onChange={(e) => setRecipientLimit(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-20 px-3 py-2 bg-white border border-[rgba(181,98,42,0.2)] rounded-lg text-sm font-bold text-[#1E1208] outline-none focus:border-[#B5622A] shadow-sm disabled:opacity-50"
                  disabled={isSending}
                  min={1}
                />
              </div>
              <div className="flex flex-col flex-1 sm:flex-initial">
                <label className="text-[9px] font-bold text-[#C8B89A] uppercase tracking-widest mb-1">Base Group</label>
                <select
                  value={audience}
                  onChange={(e: any) => setAudience(e.target.value)}
                  className="w-full sm:w-auto px-4 py-2 bg-white border border-[rgba(181,98,42,0.2)] rounded-lg text-sm font-bold text-[#1E1208] outline-none focus:border-[#B5622A] cursor-pointer shadow-sm disabled:opacity-50"
                  disabled={isSending}
                >
                  <option value="all">All Contacts</option>
                  <option value="men">Men Only</option>
                  <option value="women">Women Only</option>
                  <option value="youth">Youth Only</option>
                  <option value="new_converts">New Converts</option>
                </select>
              </div>
            </div>
          </div>

          {/* Individual Recipient Selection Tool */}
          <div className="mt-2 border-t border-[rgba(181,98,42,0.1)] pt-4">
            <button
              type="button"
              onClick={() => setIsListExpanded(!isListExpanded)}
              className="flex items-center justify-between w-full text-[11px] font-bold text-[#B5622A] uppercase tracking-widest hover:text-[#7A4F30] transition-colors"
            >
              <span>{isListExpanded ? 'Close Recipient List' : 'Select Individual Recipients'}</span>
              <span className="bg-[#B5622A] text-white px-2 py-0.5 rounded-full text-[9px]">
                {selectedIds.size} Selected
              </span>
            </button>

            {isListExpanded && (
              <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C8B89A]" />
                    <input
                      type="text"
                      placeholder="Search by name or phone..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-white border border-[rgba(181,98,42,0.1)] rounded-xl text-sm focus:border-[#B5622A] outline-none transition-all"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={toggleAllVisible}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-[rgba(181,98,42,0.1)] rounded-xl text-[11px] font-bold text-[#7A4F30] hover:border-[#B5622A] transition-all"
                  >
                    {searchableMembers.every(m => selectedIds.has(m.id)) ? (
                      <CheckSquare className="w-4 h-4 text-[#B5622A]" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    Toggle All
                  </button>
                </div>

                <div className="max-h-[240px] overflow-y-auto pr-2 custom-scrollbar grid grid-cols-1 md:grid-cols-2 gap-2">
                  {searchableMembers.length > 0 ? (
                    searchableMembers.map((member) => (
                      <div
                        key={member.id}
                        onClick={() => toggleMember(member.id)}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                          selectedIds.has(member.id)
                            ? 'bg-white border-[#B5622A] shadow-sm'
                            : 'bg-white/30 border-transparent hover:border-[rgba(181,98,42,0.2)] opacity-60'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          selectedIds.has(member.id) ? 'bg-[rgba(181,98,42,0.1)] text-[#B5622A]' : 'bg-gray-100 text-gray-400'
                        }`}>
                          {member.source === 'member' ? <User className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] font-bold truncate ${selectedIds.has(member.id) ? 'text-[#1E1208]' : 'text-[#9A7E65]'}`}>
                            {member.full_name}
                          </p>
                          <p className="text-[10px] text-[#C8B89A] font-medium">{member.phone_number}</p>
                        </div>
                        {selectedIds.has(member.id) ? (
                          <CheckSquare className="w-4 h-4 text-[#B5622A]" />
                        ) : (
                          <Square className="w-4 h-4 text-[#C8B89A]" />
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full py-8 text-center text-[#9A7E65] font-medium italic">
                      No matching recipients found in this group.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="block text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Message Content</label>
            <span className="text-[10px] font-medium text-[#9A7E65]">Tip: Use <strong className="text-[#B5622A]">{"{name}"}</strong> or <strong className="text-[#B5622A]">{"{first_name}"}</strong> to personalize!</span>
          </div>
          <textarea 
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message here... (e.g., Don't forget tomorrow's special Sunday service!)"
            className="w-full px-5 py-4 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] rounded-2xl text-[14px] focus:border-[#B5622A] outline-none transition-all resize-none text-[#1E1208] font-medium placeholder:text-[#C8B89A]"
            required
          ></textarea>
          <div className="flex justify-between items-center mt-2 px-1">
            <span className="text-[10px] text-[#9A7E65] font-medium tracking-wide">1 SMS ≈ 160 characters</span>
            <div className="flex items-center gap-3">
              {message.length > 160 && (
                <span className="text-[9px] font-bold text-[#B5622A] animate-pulse uppercase tracking-widest bg-[rgba(181,98,42,0.1)] px-2 py-0.5 rounded">
                  {Math.ceil(message.length / 160)} Parts
                </span>
              )}
              <span className={`text-[11px] font-bold tracking-tight ${message.length > 160 ? 'text-[#B5622A]' : 'text-[#9A7E65]'}`}>
                {message.length} <span className="text-[9px] text-[#C8B89A] font-medium uppercase ml-0.5">chars</span>
              </span>
            </div>
          </div>
        </div>
        
        {progress.active && (
          <div className="pt-2 animate-in fade-in duration-500">
            <div className="flex justify-between items-center text-[11px] font-bold text-[#7A4F30] mb-2.5 uppercase tracking-wider">
              <span>Broadcasting...</span>
              <span>{Math.round(((progress.sent + progress.failed) / progress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-[rgba(90,55,20,0.08)] rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-[#B5622A] h-1.5 rounded-full transition-all duration-300 relative shadow-[0_0_8px_rgba(181,98,42,0.3)]" 
                style={{ width: `${((progress.sent + progress.failed) / progress.total) * 100}%` }}
              >
                <div className="absolute top-0 bottom-0 left-0 right-0 bg-white/10 animate-pulse" />
              </div>
            </div>
            <div className="flex justify-between items-center text-[10px] text-[#9A7E65] font-bold mt-2 uppercase tracking-widest">
              <span>{progress.sent + progress.failed} / {progress.total} Processed</span>
              {progress.failed > 0 && <span className="text-[#B5622A]">{progress.failed} Failed</span>}
            </div>
          </div>
        )}

        <div className="pt-4">
          <button 
            type="submit"
            disabled={finalMembers.length === 0 || !message.trim() || isSending}
            className="w-full sm:w-auto px-10 py-4 bg-[#2B1A0E] text-[#F5E6CE] rounded-xl text-sm font-bold hover:bg-[#3D2614] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg flex items-center justify-center gap-3 uppercase tracking-widest"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send Broadcast ({finalMembers.length})
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
