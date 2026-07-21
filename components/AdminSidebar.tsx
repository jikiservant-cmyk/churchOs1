'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, UserPlus, MessageSquare, ClipboardList, Settings, LogOut, Menu, X } from 'lucide-react';
import type { Church } from '@/lib/db';

export default function AdminSidebar({ church, churchSlug }: { church: Church, churchSlug: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const toggleSidebar = () => setIsOpen(!isOpen);

  const navLinks = [
    { href: `/${churchSlug}/admin`, icon: LayoutDashboard, label: 'Dashboard' },
    { href: `/${churchSlug}/admin/members`, icon: Users, label: 'Members' },
    { href: `/${churchSlug}/admin/attendance`, icon: ClipboardList, label: 'Attendance' },
    { href: `/${churchSlug}/admin/new-converts`, icon: UserPlus, label: 'New Converts' },
    { href: `/${churchSlug}/admin/messages`, icon: MessageSquare, label: 'Messages' },
    { href: `/${churchSlug}/admin/settings`, icon: Settings, label: 'Settings' },
  ];

  return (
    <>
      {/* Mobile Menu Button (Top Left) */}
      <button 
        onClick={toggleSidebar}
        className="md:hidden fixed top-3 left-4 z-50 p-2 bg-[#F0E6D3] rounded-xl shadow-sm border border-[rgba(90,55,20,0.13)] text-[#1E1208] hover:text-[#B5622A] transition-colors"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Backdrop for Mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-[#2B1A0E]/40 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar - Slide out for mobile, fixed for desktop */}
      <aside 
        style={{ fontFamily: "'Outfit', sans-serif" }}
        className={`
          fixed md:static inset-y-0 left-0 z-50 w-64 bg-[#2B1A0E] flex flex-col
          transition-transform duration-300 ease-in-out px-4 py-7
          ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <div className="mb-8 px-2 flex items-center justify-between">
          <div className="flex flex-col">
            <h2 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#F5E6CE] leading-tight truncate">
              {church.name}
            </h2>
            <p className="text-[10px] font-semibold text-[rgba(245,230,206,0.35)] uppercase tracking-widest mt-1">
              Admin Portal
            </p>
          </div>
          {/* Close button inside sidebar for mobile */}
          <button onClick={toggleSidebar} className="md:hidden p-1.5 text-[rgba(255,235,210,0.55)] hover:text-white rounded-lg">
             <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link 
                key={link.href} 
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2 rounded-lg font-medium transition-all text-[13px] ${
                  isActive 
                    ? 'bg-[rgba(255,220,170,0.14)] text-[#F5E6CE] font-bold' 
                    : 'text-[rgba(255,235,210,0.55)] hover:text-[rgba(255,235,210,0.9)] hover:bg-[rgba(255,220,170,0.08)]'
                }`}
              >
                <link.icon className={`w-4 h-4 ${isActive ? 'text-[#B5622A]' : 'opacity-70'}`} />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Dynamic Scripture Card (from snippet) */}
        <div className="mt-4 p-3.5 rounded-xl bg-[rgba(255,220,170,0.07)] border border-[rgba(255,220,170,0.1)]">
          <p className="text-[11px] italic text-[rgba(245,230,206,0.6)] leading-relaxed">
            &quot;I can do all things through Christ who strengthens me.&quot;
          </p>
          <p className="text-[10px] font-bold text-[#B5622A] uppercase tracking-wider mt-2">
            PHIL. 4:13
          </p>
        </div>

        <div className="mt-8 pt-4 border-t border-[rgba(255,220,170,0.1)]">
          <form action="/api/auth/logout" method="POST">
             <input type="hidden" name="churchSlug" value={churchSlug} />
             <button type="submit" className="flex items-center gap-3 px-3.5 py-2 text-[rgba(255,235,210,0.55)] hover:text-[#B5622A] hover:bg-[rgba(255,220,170,0.08)] rounded-lg text-[13px] font-bold transition-all w-full">
               <LogOut className="w-4 h-4" />
               Sign Out
             </button>
          </form>
        </div>
      </aside>
    </>
  );
}
