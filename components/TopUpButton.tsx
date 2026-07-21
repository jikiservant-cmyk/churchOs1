'use client';

import React, { useState } from 'react';
import TopUpModal from './TopUpModal';

export default function TopUpButton({ churchId = "placeholder", className = "mt-2 text-[11px] font-bold text-white bg-[#B5622A] px-3 py-1.5 rounded hover:bg-[#9a5121] transition-colors inline-block w-fit" }: { churchId?: string, className?: string }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={className}
      >
        Top Up Balance
      </button>
      
      <TopUpModal 
        churchId={churchId}
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </>
  );
}
