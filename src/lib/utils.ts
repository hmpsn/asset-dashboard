import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Count words in a TipTap HTML string by stripping tags first.
 * `<p>Hello world</p>` → 2, not 4 (which a naïve split would yield by counting the tags).
 */
export function countWordsFromHtml(html: string): number {
  const plain = html.replace(/<[^>]+>/g, ' ');
  return plain.split(/\s+/).filter(w => w.length > 0).length;
}
