import * as fs from 'fs';
import * as path from 'path';

// Load user roster
const usersRaw = fs.readFileSync('./data/users.csv', 'utf-8');

// Stream orders log
const ordersStream = fs.createReadStream('./data/orders.jsonl');

// Load product catalogue
const products = JSON.parse(fs.readFileSync('./data/products.json', 'utf-8'));

// Load quarterly metrics spreadsheet
const metricsPath = './data/metrics.xlsx';

// Load sensor readings (parquet)
const sensorsPath = './data/sensors.parquet';

// Load quarterly report PDF
const reportBuffer = fs.readFileSync('./data/report.pdf');

export function getUserCount(): number {
  return usersRaw.split('\n').length - 2;
}

export function processOrders(handler: (chunk: Buffer) => void): void {
  ordersStream.on('data', handler);
}

export function findProduct(id: string) {
  return products.find((p: any) => p.id === id);
}

export function getReportSize(): number {
  return reportBuffer.length;
}
