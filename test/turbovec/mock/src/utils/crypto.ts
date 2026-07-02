/** Generate a universally unique identifier (UUID v4). */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** Compute a simple hash of a string for caching purposes. */
export function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** Encode data to Base64 for safe HTTP transmission. */
export function encodeBase64(data: string): string {
  return Buffer.from(data).toString('base64');
}
