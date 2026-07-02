/** Low-level database access */
export class Database {
  connect(url: string): void { /* connect */ }
  query(sql: string): unknown[] { return []; }
  disconnect(): void { /* disconnect */ }
}
