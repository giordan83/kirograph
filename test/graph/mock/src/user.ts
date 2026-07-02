import { Database } from './database';

/** User data access */
export class UserRepository {
  private db: Database;
  constructor() { this.db = new Database(); }
  findById(id: string): object | null { return this.db.query(`SELECT * FROM users WHERE id='${id}'`)[0] ?? null; }
  findAll(): object[] { return this.db.query('SELECT * FROM users'); }
}
