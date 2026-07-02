import { Database } from '../core/database';
import { Logger } from '../core/logger';

export class AuthService {
  private db = new Database();
  private log = new Logger();
  login(email: string): boolean {
    const result = this.db.query(`SELECT 1 FROM users WHERE email='${email}'`);
    this.log.info(`Login attempt: ${email}`);
    return result.length > 0;
  }
  logout(): void { this.log.info('Logout'); }
}
