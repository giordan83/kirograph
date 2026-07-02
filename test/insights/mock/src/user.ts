import { BaseService, IRepository } from './base';

export interface User { id: string; email: string; name: string; }

/** User repository — intentionally has many methods (god class candidate) */
export class UserRepository extends BaseService implements IRepository<User> {
  private store: User[] = [];

  constructor() { super('UserRepository'); }
  init(): void { this.log('initialized'); }

  findById(id: string): User | null { return this.store.find(u => u.id === id) ?? null; }
  findAll(): User[] { return this.store; }
  create(user: User): User { this.store.push(user); return user; }
  update(id: string, patch: Partial<User>): User | null {
    const u = this.findById(id);
    if (!u) return null;
    Object.assign(u, patch);
    return u;
  }
  delete(id: string): boolean {
    const idx = this.store.findIndex(u => u.id === id);
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }
  count(): number { return this.store.length; }
  exists(id: string): boolean { return this.findById(id) !== null; }
  findByEmail(email: string): User | null { return this.store.find(u => u.email === email) ?? null; }
  validate(user: User): boolean { return !!user.email && !!user.name; }
  toJSON(): object[] { return this.store.map(u => ({ ...u })); }
}
