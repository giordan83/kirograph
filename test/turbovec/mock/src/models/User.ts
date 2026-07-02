/** Represents a user account in the system. */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  createdAt: Date;
}

/** User account status enumeration. */
export type AccountStatus = 'active' | 'suspended' | 'pending_verification';

/** Manages user entity persistence and retrieval. */
export class UserRepository {
  private users = new Map<string, UserProfile>();

  /** Find a user account by their email address. */
  findByEmail(email: string): UserProfile | undefined {
    return [...this.users.values()].find(u => u.email === email);
  }

  /** Persist a new user profile to the data store. */
  save(user: UserProfile): void {
    this.users.set(user.id, user);
  }

  /** Remove a user account permanently. */
  delete(userId: string): boolean {
    return this.users.delete(userId);
  }

  /** Count total registered users. */
  count(): number {
    return this.users.size;
  }
}
