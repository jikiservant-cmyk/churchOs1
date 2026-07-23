'use client';

import { useFormStatus } from 'react-dom';

export default function SubmitButton({ 
  children, 
  className = '', 
  pendingText = 'Saving...' 
}: { 
  children: React.ReactNode; 
  className?: string; 
  pendingText?: string 
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} ${pending ? 'opacity-70 cursor-not-allowed' : ''}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
