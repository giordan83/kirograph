import { AuthService } from './auth';
import { UserRepository } from './user';

/** Application entry point */
export class App {
  private auth: AuthService;
  private users: UserRepository;
  constructor() {
    this.auth = new AuthService();
    this.users = new UserRepository();
  }
  start(): void {
    const token = this.auth.login('admin@example.com', 'secret');
    if (token) {
      const users = this.users.findAll();
      console.log(`Logged in, ${users.length} users found`);
    }
  }
}
