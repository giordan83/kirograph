import { BaseService, IService } from './base';
import { UserRepository } from './user';
import { TokenManager } from './token';

/**
 * Authentication service.
 * Handles login, logout, and token validation.
 */
export class AuthService extends BaseService {
  private users: UserRepository;
  private tokens: TokenManager;

  constructor() {
    super('AuthService');
    this.users = new UserRepository();
    this.tokens = new TokenManager();
  }

  init(): void { this.log('initialized'); }

  /** Log in with email and password */
  login(email: string, password: string): string | null {
    const user = this.users.findAll().find((u: any) => u.email === email);
    if (!user) return null;
    return this.tokens.sign({ email });
  }

  // no JSDoc intentionally
  logout(token: string): void {
    this.tokens.verify(token);
  }

  validateToken(token: string): boolean {
    return this.tokens.verify(token) !== null;
  }
}
