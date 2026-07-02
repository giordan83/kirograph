import { Validator } from './validator';

export class DataProcessor {
  private validator = new Validator();

  /** Complex method with high cyclomatic complexity */
  processAll(items: unknown[]): unknown[] {
    const results: unknown[] = [];
    for (const item of items) {
      if (!item) continue;
      if (typeof item === 'string') {
        if (item.length === 0) continue;
        if (item.startsWith('skip')) continue;
        if (this.validator.validate(item)) {
          if (item.includes('@')) {
            results.push({ type: 'email', value: item });
          } else if (item.match(/^\d+$/)) {
            results.push({ type: 'number', value: parseInt(item) });
          } else {
            results.push({ type: 'text', value: item });
          }
        }
      } else if (typeof item === 'number') {
        if (item < 0) {
          results.push({ type: 'negative', value: item });
        } else if (item === 0) {
          results.push({ type: 'zero', value: item });
        } else if (item > 1000) {
          results.push({ type: 'large', value: item });
        } else {
          results.push({ type: 'positive', value: item });
        }
      } else if (Array.isArray(item)) {
        for (const nested of item) {
          if (nested !== null && nested !== undefined) {
            results.push({ type: 'nested', value: nested });
          }
        }
      }
    }
    return results;
  }

  simpleAdd(a: number, b: number): number { return a + b; }
}
