import { UserRepository } from './user';
import { TokenManager } from './token';

/** Authentication service */
export class AuthService {
  private users: UserRepository;
  private tokens: TokenManager;
  constructor() {
    this.users = new UserRepository();
    this.tokens = new TokenManager();
  }
  login(email: string, password: string): string | null {
    const user = this.users.findAll().find((u: any) => u.email === email);
    if (!user) return null;
    return this.tokens.sign({ email });
  }
  logout(token: string): void {
    this.tokens.verify(token);
  }
  validateToken(token: string): boolean {
    return this.tokens.verify(token) !== null;
  }
}
