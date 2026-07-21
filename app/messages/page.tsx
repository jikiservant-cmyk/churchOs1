import React from 'react';
import MessagesView from '@/components/MessagesView';

export default function MessagesPage() {
  return (
    <div className="h-[calc(100vh-64px)]">
      <MessagesView churchId="placeholder" />
    </div>
  );
}
