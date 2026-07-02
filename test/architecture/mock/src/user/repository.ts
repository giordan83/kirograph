import { Database } from '../core/database';
import { User } from './model';

export class UserRepository {
  private db = new Database();
  findById(id: string): User | null {
    return (this.db.query(`SELECT * FROM users WHERE id='${id}'`)[0] as User) ?? null;
  }
  findAll(): User[] { return this.db.query('SELECT * FROM users') as User[]; }
}
