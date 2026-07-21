'use client';

import { useState, useEffect } from 'react';
import { X, Smartphone, CreditCard, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { initiateNajikiPayment } from '@/lib/wallet-actions';
import { toast } from 'sonner';

interface TopUpModalProps {
  churchId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function TopUpModal({ churchId, isOpen, onClose }: TopUpModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [amount, setAmount] = useState('5000');
  const [customAmount, setCustomAmount] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      setIsSuccess(false); // Reset success state when opening
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    
    const finalAmount = customAmount ? parseInt(customAmount, 10) : parseInt(amount, 10);
    
    if (isNaN(finalAmount) || finalAmount < 2000) {
      toast.error('Please enter a valid amount (minimum 2,000 UGX)');
      return;
    }

    if (!phone || phone.length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }

    setIsSubmitting(true);

    try {
      // Use the existing formData but ensure amount is set correctly
      const formData = new FormData(e.currentTarget);
      formData.set('amount', finalAmount.toString());
      
      console.log('Submitting top-up for amount:', finalAmount, 'phone:', phone);

      const result = await initiateNajikiPayment(formData);
      if (result?.success) {
        setIsSuccess(true);
        toast.success(result.message || 'Payment prompt sent!');
        // Don't close immediately, show the success state
      } else {
        toast.error(result?.error || 'Failed to initiate payment');
      }
    } catch (err) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 cursor-pointer"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md bg-[#F0E6D3] rounded-[2rem] shadow-2xl border border-[rgba(90,55,20,0.13)] overflow-hidden animate-in zoom-in-95 duration-200 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative pt-8 pb-6 px-8 text-center border-b border-[rgba(90,55,20,0.05)]">
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 p-2 text-[#9A7E65] hover:text-[#1E1208] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="w-16 h-16 bg-[#B5622A]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CreditCard className="w-8 h-8 text-[#B5622A]" />
          </div>
          
          <h2 style={{ fontFamily: "'Playfair Display', serif" }} className="text-2xl font-bold text-[#1E1208]">
            Wallet Top Up
          </h2>
          <p className="text-[13px] text-[#9A7E65] mt-1 font-medium">
            Add SMS credits via Najiki Mobile Money
          </p>
        </div>

        {/* Form or Success State */}
        {isSuccess ? (
          <div className="p-12 text-center space-y-6 animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-[#1E1208]">Prompt Sent!</h3>
              <p className="text-sm text-[#9A7E65] leading-relaxed">
                Please check your phone (<strong>{phone}</strong>) and enter your Mobile Money PIN to complete the payment of <strong>UGX {(customAmount ? parseInt(customAmount) : parseInt(amount)).toLocaleString()}</strong>.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full py-4 bg-[#2B1A0E] text-[#F5E6CE] rounded-2xl font-bold text-[13px] uppercase tracking-widest hover:bg-[#3D2614] transition-all shadow-lg shadow-[#2B1A0E]/20"
            >
              Close Window
            </button>
            <p className="text-[11px] text-[#9A7E65] italic">
              Your balance will update automatically once confirmed.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <input type="hidden" name="churchId" value={churchId} />
            
            <div className="space-y-4">
              {/* Phone Number */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest ml-1">
                  Mobile Money Number
                </label>
                <div className="relative">
                  <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9A7E65]" />
                  <input
                    type="text"
                    name="phoneNumber"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="07..."
                    className="w-full pl-11 pr-4 py-3.5 bg-white/50 border border-[#E9E1D2] rounded-2xl text-sm text-[#1E1208] placeholder:text-[#9A7E65]/50 focus:outline-none focus:border-[#B5622A] focus:ring-1 focus:ring-[#B5622A] transition-all"
                    required
                  />
                </div>
              </div>

              {/* Amount Selection */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest ml-1">
                  Select or Enter Amount (Min 2,000 UGX)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {['5000', '10000', '20000', '50000'].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setAmount(amt);
                        setCustomAmount('');
                      }}
                      className={`py-3 px-4 rounded-xl text-sm font-bold transition-all border ${
                        amount === amt && !customAmount
                          ? 'bg-[#B5622A] text-white border-[#B5622A] shadow-md' 
                          : 'bg-white/50 text-[#1E1208] border-[#E9E1D2] hover:border-[#B5622A]/30'
                      }`}
                    >
                      {parseInt(amt).toLocaleString()}
                    </button>
                  ))}
                </div>
                
                {/* Custom Amount Input */}
                <div className="mt-3 relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[12px] font-bold text-[#9A7E65]">UGX</div>
                  <input
                    type="number"
                    placeholder="Enter custom amount (e.g. 2500)"
                    value={customAmount}
                    onChange={(e) => {
                      setCustomAmount(e.target.value);
                      setAmount(''); // Deselect buttons when typing
                    }}
                    className="w-full pl-14 pr-4 py-3.5 bg-white/50 border border-[#E9E1D2] rounded-2xl text-sm text-[#1E1208] placeholder:text-[#9A7E65]/50 focus:outline-none focus:border-[#B5622A] focus:ring-1 focus:ring-[#B5622A] transition-all"
                  />
                </div>
                <input type="hidden" name="amount" value={customAmount || amount} />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-4 bg-[#2B1A0E] text-[#F5E6CE] rounded-2xl font-bold text-[13px] uppercase tracking-widest hover:bg-[#3D2614] transition-all shadow-lg shadow-[#2B1A0E]/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Initiating...
                  </>
                ) : (
                  <>
                    Confirm & Pay
                    <CheckCircle2 className="w-4 h-4" />
                  </>
                )}
              </button>
              
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="w-full py-3 text-[#9A7E65] hover:text-[#1E1208] text-[11px] font-bold uppercase tracking-widest transition-colors"
              >
                Cancel
              </button>
            </div>

            <div className="flex items-center gap-2 justify-center py-2">
              <AlertCircle className="w-3.5 h-3.5 text-[#9A7E65]" />
              <p className="text-[11px] text-[#9A7E65] font-medium">
                You will receive a PIN prompt on your phone.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
