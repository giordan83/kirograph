export class TokenManager {
  sign(payload: object): string { return JSON.stringify(payload); }
  verify(token: string): object | null {
    try { return JSON.parse(token); } catch { return null; }
  }
}
