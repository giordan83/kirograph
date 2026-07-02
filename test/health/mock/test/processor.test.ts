import { DataProcessor } from '../src/processor';
// Fake tests — just enough for test-map to find the link
const p = new DataProcessor();
console.assert(p.simpleAdd(1, 2) === 3, 'simpleAdd works');
