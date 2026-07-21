import React from 'react';
import Link from 'next/link';
import { Home, Users, CreditCard, MessageSquare, Settings, Bell } from 'lucide-react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-100 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-100">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
            <span className="text-white font-bold font-sans">C</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">ChurchOS</h1>
        </div>
        
        <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
          <Link href="/" className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-blue-600 transition-colors font-medium">
            <Home className="w-5 h-5" />
            <span>Dashboard</span>
          </Link>
          <Link href="#" className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-blue-600 transition-colors font-medium">
            <Users className="w-5 h-5" />
            <span>Members</span>
          </Link>
          <Link href="#" className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-blue-600 transition-colors font-medium">
            <CreditCard className="w-5 h-5" />
            <span>Tithe & Giving</span>
          </Link>
          <Link href="/messages" className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-blue-700 bg-blue-50 font-medium">
            <MessageSquare className="w-5 h-5" />
            <span>Messages</span>
          </Link>
        </nav>
        
        <div className="p-4 border-t border-gray-100">
          <Link href="#" className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-blue-600 transition-colors font-medium">
            <Settings className="w-5 h-5" />
            <span>Settings</span>
          </Link>
        </div>
      </aside>

      {/* Main content wrapper */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-8">
          <div className="text-xl font-semibold text-gray-800"></div>
          <div className="flex items-center space-x-4">
            <button className="p-2 text-gray-400 hover:text-gray-600 bg-gray-50 rounded-full">
              <Bell className="w-5 h-5" />
            </button>
            <div className="h-8 w-8 bg-blue-600 rounded-full border-2 border-white shadow-sm flex justify-center items-center">
              <span className="text-white text-xs font-bold">A</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}
