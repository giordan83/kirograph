import { ServiceLayer } from './service';
export class App {
  private service = new ServiceLayer();
  run(): void { this.service.process(['hello', 42, 'skip-me']); }
}
