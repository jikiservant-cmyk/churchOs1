'use client';

import React, { useState } from 'react';
import { CreditCard, MessageSquare, Plus } from 'lucide-react';
import { PaymentProvider } from '@/lib/payments/payment-service';

const SMS_PRICE = 15; // e.g., 15 UGX per SMS

export default function TopUpForm() {
  const [smsAmount, setSmsAmount] = useState<number>(1000);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [provider, setProvider] = useState<PaymentProvider>('xente');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const totalCost = smsAmount * SMS_PRICE;

  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/topups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smsAmount,
          phone: phoneNumber,
          provider
        }),
      });

      const data = await response.json();

      if (response.ok && data.paymentUrl) {
        // Redirect to payment URL
        window.location.href = data.paymentUrl;
      } else {
        setMessage(data.error || 'Failed to initiate payment.');
      }
    } catch (err) {
      console.error(err);
      setMessage('An error occurred while initiating the payment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full p-6 md:p-8 bg-white rounded-2xl">
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-gray-100">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">SMS Balance</h2>
          <p className="text-gray-500 mt-1">Top up your account balance to send messages</p>
        </div>
        <div className="flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl">
          <MessageSquare className="w-8 h-8 text-blue-600" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 flex flex-col justify-center">
          <p className="text-sm font-medium text-gray-500 mb-1">Current Balance</p>
          <div className="flex items-baseline space-x-1">
            <span className="text-4xl font-extrabold text-gray-900">145</span>
            <span className="text-gray-500 font-medium">SMS</span>
          </div>
        </div>
        
        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex flex-col justify-center relative overflow-hidden">
          <div className="z-10">
            <p className="text-sm font-medium text-blue-600 mb-1">Cost Per SMS</p>
            <div className="flex items-baseline space-x-1">
              <span className="text-4xl font-extrabold text-blue-900">{SMS_PRICE}</span>
              <span className="text-blue-600 font-medium tracking-tight">UGX</span>
            </div>
          </div>
          <CreditCard className="absolute -bottom-4 -right-4 w-32 h-32 text-blue-200 opacity-50 z-0" />
        </div>
      </div>

      <form onSubmit={handleTopUp} className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">Select Amount</label>
          <div className="grid grid-cols-3 gap-3">
            {[500, 1000, 5000].map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setSmsAmount(amount)}
                className={`py-3 px-4 rounded-xl font-medium transition-all ${
                  smsAmount === amount
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                    : 'bg-white border-2 border-gray-100 text-gray-600 hover:border-blue-200 hover:bg-blue-50'
                }`}
              >
                {amount.toLocaleString()} 
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="custom-amount" className="block text-sm font-semibold text-gray-900 mb-2">Custom Amount (SMS)</label>
          <input
            id="custom-amount"
            type="number"
            min="100"
            value={smsAmount}
            onChange={(e) => setSmsAmount(parseInt(e.target.value) || 0)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 font-medium"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-semibold text-gray-900 mb-2">Phone Number</label>
          <input
            id="phone"
            type="tel"
            required
            placeholder="e.g. 2567XXXXXXX"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">Payment Option</label>
          <select 
            value={provider}
            onChange={(e) => setProvider(e.target.value as PaymentProvider)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
          >
            <option value="xente">Xente (Recommended)</option>
            <option value="pesapal">Pesapal</option>
            <option value="flutterwave">Flutterwave</option>
          </select>
        </div>

        {message && (
          <div className="p-4 rounded-xl bg-red-50 text-red-600 text-sm font-medium">
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || totalCost <= 0 || !phoneNumber}
          className="w-full bg-gray-900 hover:bg-black text-white font-semibold py-4 px-8 rounded-xl transition-all shadow-lg flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span>Initiating Payment...</span>
          ) : (
            <>
              <Plus className="w-5 h-5" />
              <span>Pay {totalCost.toLocaleString()} UGX</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
