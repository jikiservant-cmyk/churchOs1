'use client';

import React, { useRef, useState } from 'react';
import Papa from 'papaparse';
import { Upload, FileUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface CSVUploaderProps {
  churchSlug: string;
  type: 'members' | 'new-converts';
  onUpload: (slug: string, data: any[]) => Promise<{ success?: boolean; error?: string }>;
}

export default function CSVUploader({ churchSlug, type, onUpload }: CSVUploaderProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setSuccess('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          if (results.errors.length > 0) {
            console.error('CSV Parsing errors:', results.errors);
            setError(`Error parsing CSV: ${results.errors[0].message}`);
            setLoading(false);
            return;
          }

          const data = results.data;
          if (data.length === 0) {
            setError('The CSV file is empty.');
            setLoading(false);
            return;
          }

          const res = await onUpload(churchSlug, data);
          if (res?.error) {
            setError(res.error);
          } else {
            setSuccess(`Successfully imported ${data.length} records.`);
            router.refresh();
            // Reset the file input
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        } catch (err: any) {
          setError(err?.message || 'An unexpected error occurred during upload.');
        } finally {
          setLoading(false);
          // auto-clear success message after 5 seconds
          setTimeout(() => setSuccess(''), 5000);
        }
      },
      error: (err: any) => {
        setError(`Failed to read file: ${err.message}`);
        setLoading(false);
      }
    });
  };

  const handleButtonClick = () => {
    if (!loading && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        type="file"
        accept=".csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      <button
        onClick={handleButtonClick}
        disabled={loading}
        className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-colors disabled:opacity-50 ${
          type === 'members'
            ? 'bg-[rgba(90,55,20,0.05)] text-[#1E1208] hover:bg-[rgba(90,55,20,0.1)]'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        }`}
      >
        {loading ? (
          <Loader2 className={`w-4 h-4 animate-spin ${type === 'members' ? 'text-[#9A7E65]' : 'text-slate-400'}`} />
        ) : (
          <FileUp className={`w-4 h-4 ${type === 'members' ? 'text-[#9A7E65]' : 'text-slate-500'}`} />
        )}
        {loading ? 'Uploading...' : 'Import CSV'}
      </button>

      {error && (
        <div className={`absolute top-4 right-4 max-w-sm mt-16 p-3 text-xs rounded-xl font-bold border flex items-start gap-2 shadow-lg z-50 animate-in fade-in slide-in-from-top-2 ${
          type === 'members'
            ? 'bg-red-50 text-[#B5622A] border-[rgba(181,98,42,0.1)]'
            : 'bg-red-50 text-[#FF4747] border-red-100'
        }`}>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className={`absolute top-4 right-4 max-w-sm mt-16 p-3 text-xs rounded-xl font-bold border flex items-start gap-2 shadow-lg z-50 animate-in fade-in slide-in-from-top-2 ${
          type === 'members'
            ? 'bg-[#F0E6D3] text-[#1E1208] border-[rgba(90,55,20,0.13)]'
            : 'bg-white text-slate-900 border-slate-200'
        }`}>
          <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${type === 'members' ? 'text-[#B5622A]' : 'text-cyan-600'}`} />
          <p>{success}</p>
        </div>
      )}
    </div>
  );
}
