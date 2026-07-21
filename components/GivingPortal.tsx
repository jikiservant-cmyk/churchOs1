'use client';

import { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Gift, Sprout, Home, Smartphone, Lock, ShieldCheck, ChevronRight } from 'lucide-react';
import type { Church } from '@/lib/db';
import { normalizeUgPhone } from '@/lib/utils';
import { initiateDonationPayment } from '@/lib/wallet-actions';

const CATEGORIES = [
  { id: 'tithe', label: 'Tithe', icon: Heart, color: 'text-rose-500', bg: 'bg-rose-50' },
  { id: 'offering', label: 'Offering', icon: Gift, color: 'text-blue-500', bg: 'bg-blue-50' },
  { id: 'seed', label: 'Seed', icon: Sprout, color: 'text-green-500', bg: 'bg-green-50' },
  { id: 'building', label: 'Building', icon: Home, color: 'text-purple-500', bg: 'bg-purple-50' },
];

const QUICK_AMOUNTS = [10000, 20000, 50000, 100000];

export default function GivingPortal({ church }: { church: Church }) {
  const [amount, setAmount] = useState<string>('');
  const [category, setCategory] = useState<string>('tithe');
  const [phone, setPhone] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, '');
    if (rawValue) {
      setAmount(parseInt(rawValue, 10).toLocaleString('en-US'));
    } else {
      setAmount('');
    }
  };

  const setQuickAmount = (val: number) => {
    setAmount(val.toLocaleString('en-US'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      // Validate and format phone number
      const fullPhone = normalizeUgPhone(phone);
      if (!fullPhone) {
        alert('Please enter a valid Ugandan phone number.');
        setIsSubmitting(false);
        return;
      }

      // 1. Initiate the LivePay payment prompt via server action
      const result = await initiateDonationPayment({
        phoneNumber: fullPhone,
        amount: parseInt(amount.replace(/,/g, ''), 10),
        category,
        churchId: church.id,
      });

      if (result.error) {
        console.error('Payment initiation failed:', result.error);
        alert(result.error);
        return;
      }

      // 2. Only notify the user AFTER the payment request is accepted by the provider
      // The confirmation SMS should be sent from the server-side webhook once payment
      // is actually confirmed by the mobile money provider — NOT here on the client.
      alert('Payment prompt sent to your phone! Please approve it on your handset.');
    } catch (err) {
      console.error('Error during submission:', err);
      alert('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
      setAmount('');
      setPhone('');
    }
  };

  return (
    <main className="min-h-screen bg-[#F8F9FA] flex flex-col items-center sm:py-8 font-sans selection:bg-blue-100">
      <div className="w-full max-w-[480px] bg-white sm:rounded-[2rem] sm:shadow-[0_8px_40px_rgb(0,0,0,0.08)] overflow-hidden flex flex-col min-h-screen sm:min-h-0 relative">
        
        {/* Premium Header */}
        <div className="relative pt-12 pb-8 px-6 overflow-hidden flex-shrink-0">
          <div className={`absolute inset-0 ${church.themeColor} opacity-10`} />
          <div className={`absolute inset-0 bg-gradient-to-b from-${church.themeColor}/20 to-transparent`} />
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 flex flex-col items-center text-center"
          >
            <div className="w-20 h-20 rounded-2xl bg-white shadow-xl shadow-black/5 p-1.5 mb-4 relative overflow-hidden ring-1 ring-black/5">
              <Image 
                src={church.logoUrl} 
                alt={church.name} 
                fill 
                className="object-cover rounded-xl" 
                referrerPolicy="no-referrer" 
              />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{church.name}</h1>
            <div className="flex items-center gap-1.5 mt-2 text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full ring-1 ring-green-600/20">
              <ShieldCheck className="w-4 h-4" />
              Verified Organization
            </div>
          </motion.div>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col px-6 pb-24 sm:pb-8">
          
          {/* Amount Input (Fintech Style) */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="mb-8"
          >
            <div className="text-center mb-6">
              <label className="text-sm font-bold text-gray-400 uppercase tracking-wider">Enter Amount</label>
              <div className="flex items-center justify-center mt-2">
                <span className="text-2xl font-bold text-gray-400 mr-2 mt-1">UGX</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  onChange={handleAmountChange}
                  placeholder="0"
                  className="w-full max-w-[200px] text-5xl font-extrabold text-gray-900 bg-transparent border-none focus:ring-0 text-center p-0 placeholder:text-gray-200 outline-none"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setQuickAmount(amt)}
                  className="py-3 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-2xl text-sm font-bold transition-all active:scale-95 ring-1 ring-gray-200/50"
                >
                  {(amt / 1000)}k
                </button>
              ))}
            </div>
          </motion.div>

          {/* Category Selection */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-8"
          >
            <label className="text-sm font-bold text-gray-900 mb-3 block">What are you giving towards?</label>
            <div className="grid grid-cols-2 gap-3">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`relative p-4 rounded-2xl border-2 text-left transition-all duration-200 flex flex-col gap-3 ${
                      isSelected 
                        ? `border-gray-900 bg-white shadow-md` 
                        : `border-transparent bg-gray-50 hover:bg-gray-100`
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${cat.bg} ${cat.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className={`font-bold ${isSelected ? 'text-gray-900' : 'text-gray-600'}`}>
                      {cat.label}
                    </span>
                    {isSelected && (
                      <div className="absolute top-4 right-4 w-5 h-5 bg-gray-900 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* Phone Number */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-8"
          >
            <label className="text-sm font-bold text-gray-900 mb-3 block">Mobile Money Number</label>
            <div className="relative flex items-center">
              <div className="absolute left-4 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-gray-400" />
                <span className="text-gray-900 font-bold border-r border-gray-200 pr-3">+256</span>
              </div>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="77X XXX XXX"
                className="w-full pl-[104px] pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-gray-900 focus:bg-white rounded-2xl text-gray-900 font-bold text-lg transition-all outline-none ring-1 ring-gray-200/50"
                required
              />
            </div>
          </motion.div>

          {/* Sticky Bottom CTA for Mobile */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-xl border-t border-gray-100 sm:relative sm:p-0 sm:bg-transparent sm:border-none sm:backdrop-blur-none z-50">
            <button
              type="submit"
              disabled={!amount || !phone || isSubmitting}
              className={`w-full relative overflow-hidden group ${church.themeColor} text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-black/10 hover:shadow-2xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0`}
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              <span className="relative flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Lock className="w-5 h-5" />
                    Pay UGX {amount || '0'}
                    <ChevronRight className="w-5 h-5 opacity-70" />
                  </>
                )}
              </span>
            </button>
            <div className="flex items-center justify-center gap-4 mt-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              <span>Secured by MTN</span>
              <div className="w-1 h-1 rounded-full bg-gray-300" />
              <span>Airtel Money</span>
            </div>
          </div>

        </form>
      </div>
    </main>
  );
}
