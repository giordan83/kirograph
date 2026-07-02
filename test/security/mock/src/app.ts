import { UserService } from './user';
export class App {
  private svc = new UserService();
  run(): void {
    const user = this.svc.findById('1');
  }
}
