import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn/ui's canonical `cn` helper. Merges Tailwind class lists while
 * resolving conflicts (e.g. `px-2 px-4` → `px-4`). Used by every ui
 * primitive.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
