import { TokenManager } from './token'; // intentionally unused import

/** Compute factorial recursively */
export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

/** Compute fibonacci recursively */
export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatDate(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}
