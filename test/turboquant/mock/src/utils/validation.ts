/** Check if a string is a valid email address format. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Sanitize user input to prevent injection attacks. */
export function sanitizeInput(raw: string): string {
  return raw.replace(/[<>"'&]/g, c => `&#${c.charCodeAt(0)};`);
}

/** Validate that a price is a positive finite number. */
export function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && value >= 0;
}
