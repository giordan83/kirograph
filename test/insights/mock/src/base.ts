/** Base service interface */
export interface IService {
  init(): void;
  destroy(): void;
}

/** Base repository interface */
export interface IRepository<T> {
  findById(id: string): T | null;
  findAll(): T[];
}

/** Abstract base class */
export abstract class BaseService implements IService {
  protected name: string;
  constructor(name: string) { this.name = name; }
  abstract init(): void;
  destroy(): void { /* cleanup */ }
  protected log(msg: string): void { console.log(`[${this.name}] ${msg}`); }
}
