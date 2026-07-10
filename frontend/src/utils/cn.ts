import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classnames safely — clsx for conditional logic, twMerge
 * to resolve conflicts (e.g. "px-2" + "px-4" → "px-4").  Used by every
 * UI primitive in src/components/ui.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
