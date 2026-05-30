import * as fs from 'fs';
import * as path from 'path';

export interface Suppression {
  cveId: string;
  reason?: string;
  suppressedAt: string;   // ISO 8601
  expiresAt?: string;     // ISO 8601, optional
}

export class SuppressionManager {
  constructor(private readonly projectRoot: string) {}

  private get filePath(): string {
    return path.join(this.projectRoot, '.kirograph', 'security-suppressions.json');
  }

  load(): Suppression[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    let all: Suppression[];
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      all = JSON.parse(raw) as Suppression[];
    } catch {
      return [];
    }

    const now = new Date();
    const active = all.filter(s => {
      if (!s.expiresAt) return true;
      return new Date(s.expiresAt) > now;
    });

    // Silently remove expired entries by rewriting if any were filtered
    if (active.length !== all.length) {
      this.save(active);
    }

    return active;
  }

  save(suppressions: Suppression[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(suppressions, null, 2), 'utf-8');
  }

  add(cveId: string, reason?: string, expiresAt?: string): void {
    const current = this.load();
    const idx = current.findIndex(s => s.cveId === cveId);

    const entry: Suppression = {
      cveId,
      suppressedAt: new Date().toISOString(),
      ...(reason ? { reason } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };

    if (idx >= 0) {
      current[idx] = entry;
    } else {
      current.push(entry);
    }

    this.save(current);
  }

  remove(cveId: string): boolean {
    const current = this.load();
    const idx = current.findIndex(s => s.cveId === cveId);
    if (idx < 0) return false;
    current.splice(idx, 1);
    this.save(current);
    return true;
  }

  isSuppressed(cveId: string): boolean {
    return this.load().some(s => s.cveId === cveId);
  }

  getActive(): Suppression[] {
    return this.load();
  }
}
