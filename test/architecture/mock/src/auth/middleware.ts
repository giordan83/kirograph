import { AuthService } from './service';

export function authMiddleware(token: string): boolean {
  const svc = new AuthService();
  return svc.login(token);
}
