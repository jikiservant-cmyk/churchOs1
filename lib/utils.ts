import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeUgPhone(input: string): string | null {
  // Strip all non-numeric characters except the leading '+'
  let raw = (input ?? '').trim();
  if (!raw) return null;

  // Remove everything except digits and '+'
  const cleaned = raw.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+256')) {
    // Must be +256 followed by 9 digits
    return /^\+256\d{9}$/.test(cleaned) ? cleaned : null;
  }

  if (cleaned.startsWith('0')) {
    const normalized = `+256${cleaned.slice(1)}`;
    return /^\+256\d{9}$/.test(normalized) ? normalized : null;
  }

  // Handle cases where user types 772... or 256772... without leading 0 or +
  if (cleaned.length === 9 && !cleaned.startsWith('+')) {
    return `+256${cleaned}`;
  }

  if (cleaned.startsWith('256') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  // Unrecognized format — reject instead of silently passing through
  return null;
}
