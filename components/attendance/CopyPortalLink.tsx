'use client';

import { useState } from 'react';
import { Copy, Check, Share2, Activity } from 'lucide-react';
import { toast } from 'sonner';

interface CopyPortalLinkProps {
  churchSlug: string;
  passkey: string;
}

export function CopyPortalLink({ churchSlug, passkey }: CopyPortalLinkProps) {
  const [copied, setCopied] = useState(false);
  const [passkeyCopied, setPasskeyCopied] = useState(false);

  const portalUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/${churchSlug}/usher`;

  const copyToClipboard = async (text: string, isPasskey: boolean = false) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      
      if (isPasskey) {
        setPasskeyCopied(true);
        toast.success('Passkey copied');
        setTimeout(() => setPasskeyCopied(false), 2000);
      } else {
        setCopied(true);
        toast.success('Link copied');
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error('Copy failed:', err);
      toast.error('Failed to copy');
    }
  };

  const handleCopy = () => copyToClipboard(portalUrl);
  const handleCopyPasskey = () => copyToClipboard(passkey, true);

  const handleOpen = () => {
    window.open(portalUrl, '_blank');
  };

  return (
    <div className="flex items-center gap-2">
      <button 
        onClick={handleCopyPasskey}
        className="flex flex-col items-end px-3 py-1 bg-[#FAF7F0] border border-[#E9E1D2] rounded-xl hover:bg-[#F5F1E8] transition-colors group relative"
        title="Click to copy passkey"
      >
        <span className="text-[8px] font-black uppercase tracking-widest text-[#9A7E65]">Passkey</span>
        <div className="flex items-center gap-1">
          <span className="text-[12px] font-black text-[#B5622A] tracking-[0.2em]">{passkey}</span>
          {passkeyCopied ? <Check className="w-2.5 h-2.5 text-[#B5622A]" /> : <Copy className="w-2.5 h-2.5 text-[#9A7E65] opacity-0 group-hover:opacity-100 transition-opacity" />}
        </div>
      </button>
      
      <button
        onClick={handleCopy}
        className="flex items-center gap-2 px-4 py-2 bg-[#B5622A] text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-[#944F22] shadow-md transition-all active:scale-95"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? 'Copied Link' : 'Copy Link'}
      </button>

      <button
        onClick={handleOpen}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-[#E9E1D2] text-[#B5622A] rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-[#FAF7F0] shadow-sm transition-all active:scale-95"
      >
        <Activity className="w-4 h-4" />
        Open
      </button>
    </div>
  );
}
