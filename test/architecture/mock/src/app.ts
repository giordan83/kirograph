import { AuthService } from './auth/service';
import { authMiddleware } from './auth/middleware';
import { UserRepository } from './user/repository';
import { Logger } from './core/logger';

export class App {
  private auth = new AuthService();
  private users = new UserRepository();
  private log = new Logger();
  start(): void {
    this.log.info('App started');
    if (authMiddleware('admin@example.com')) {
      const all = this.users.findAll();
      this.log.info(`${all.length} users loaded`);
    }
  }
}
