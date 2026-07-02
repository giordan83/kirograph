export class Logger {
  log(level: string, msg: string): void { console.log(`[${level}] ${msg}`); }
  info(msg: string): void { this.log('INFO', msg); }
  error(msg: string): void { this.log('ERROR', msg); }
}
