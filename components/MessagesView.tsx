'use client';

import React, { useState } from 'react';
import { Send, Plus, MoreVertical, Phone, Search, MessageSquare } from 'lucide-react';
import TopUpModal from './TopUpModal';

const DUMMY_MESSAGES = [
  { id: 1, sender: '+256 701 234 567', text: 'Hey, are we still on for the meeting tomorrow?', time: '10:45 AM', unread: true },
  { id: 2, sender: '+256 772 987 654', text: 'The payment has been received successfully. Thank you!', time: 'Yesterday', unread: false },
  { id: 3, sender: '+256 753 111 222', text: 'Please send me the updated proposal when you can.', time: 'Monday', unread: false },
  { id: 4, sender: 'MTN Mobile Money', text: 'Yello. You have received UGX 500,000 from John Doe.', time: 'Sunday', unread: false },
];

export default function MessagesView({ churchId }: { churchId: string }) {
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);

  return (
    <div className="flex flex-col h-full bg-white shadow-xl shadow-gray-200">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-gray-100 bg-white">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
          <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">
            145 SMS Left
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={() => setIsTopUpOpen(true)}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm shadow-blue-200"
          >
            <Plus className="w-4 h-4" />
            <span>Top Up Balance</span>
          </button>
          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content: Sidebar + Chat Area */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Sidebar: Conversations */}
        <div className="w-full md:w-1/3 lg:w-1/4 border-r border-gray-100 flex flex-col bg-gray-50/50">
          <div className="p-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
              </div>
              <input 
                type="text" 
                placeholder="Search messages..." 
                className="w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm"
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {DUMMY_MESSAGES.map((msg) => (
              <div 
                key={msg.id} 
                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-white transition-colors ${msg.unread ? 'bg-white' : 'bg-transparent'}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className={`font-semibold text-sm ${msg.unread ? 'text-gray-900' : 'text-gray-700'}`}>{msg.sender}</h3>
                  <span className="text-xs text-gray-500">{msg.time}</span>
                </div>
                <p className={`text-sm line-clamp-2 ${msg.unread ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                  {msg.text}
                </p>
              </div>
            ))}
          </div>

          {/* Mobile Top Up Banner */}
          <div className="md:hidden p-4 border-t border-gray-100 bg-white">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col items-center w-full">
              <p className="text-sm text-blue-800 font-medium mb-2">Running low on texts?</p>
              <button 
                onClick={() => setIsTopUpOpen(true)}
                className="w-full flex justify-center items-center space-x-2 bg-white border border-blue-200 hover:border-blue-300 text-blue-700 px-3 py-2 rounded-lg text-sm font-medium shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Top Up Balance</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Area: Selected Conversation (Placeholder) */}
        <div className="hidden md:flex flex-col flex-1 bg-white">
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="w-10 h-10 text-gray-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Your Messages</h2>
            <p className="text-gray-500 max-w-sm">
              Select a conversation from the left to start reading or sending SMS messages.
            </p>
            <div className="mt-8 w-full max-w-md">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 flex flex-col items-center w-full mb-4">
                <p className="text-sm text-blue-800 font-medium mb-3">Running low on texts?</p>
                <button 
                  onClick={() => setIsTopUpOpen(true)}
                  className="w-full flex justify-center items-center space-x-2 bg-white border border-blue-200 hover:border-blue-300 text-blue-700 px-4 py-2.5 rounded-lg font-medium shadow-sm transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Top Up Balance</span>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
      
      <TopUpModal churchId={churchId} isOpen={isTopUpOpen} onClose={() => setIsTopUpOpen(false)} />
    </div>
  );
}
