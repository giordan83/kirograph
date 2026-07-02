import { DataProcessor } from './processor';
import { Validator } from './validator';

export class ServiceLayer {
  private processor = new DataProcessor();
  private validator = new Validator();
  process(items: unknown[]): unknown[] { return this.processor.processAll(items); }
  handle(value: string): boolean { return this.validator.validate(value); }
}
