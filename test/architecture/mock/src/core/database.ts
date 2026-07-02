/** Shared database — imported by auth and user packages */
export class Database {
  connect(url: string): void { /* connect */ }
  query(sql: string): unknown[] { return []; }
  disconnect(): void { /* disconnect */ }
}
