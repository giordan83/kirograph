/** JWT token management */
export class TokenManager {
  sign(payload: object): string { return ''; }
  verify(token: string): object | null { return null; }
}
