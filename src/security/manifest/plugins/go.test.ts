/**
 * Unit tests for the Go security manifest plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseGoManifest } from './go';

describe('parseGoManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirograph-go-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeGoMod(content: string, dir?: string): string {
    const targetDir = dir ?? tmpDir;
    fs.mkdirSync(targetDir, { recursive: true });
    const filePath = path.join(targetDir, 'go.mod');
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function writeGoSum(content: string, dir?: string): void {
    const targetDir = dir ?? tmpDir;
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'go.sum'), content);
  }

  it('extracts dependencies from require block', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    const gin = deps.find(d => d.name === 'github.com/gin-gonic/gin');
    expect(gin).toBeDefined();
    expect(gin!.declaredConstraint).toBe('v1.9.1');
    expect(gin!.resolvedVersion).toBe('v1.9.1');
    expect(gin!.scope).toBe('production');
    expect(gin!.ecosystem).toBe('go');

    const testify = deps.find(d => d.name === 'github.com/stretchr/testify');
    expect(testify).toBeDefined();
    expect(testify!.declaredConstraint).toBe('v1.8.4');
    expect(testify!.resolvedVersion).toBe('v1.8.4');
  });

  it('extracts single-line require directives', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require github.com/pkg/errors v0.9.1
require golang.org/x/text v0.14.0
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    expect(deps.find(d => d.name === 'github.com/pkg/errors')).toBeDefined();
    expect(deps.find(d => d.name === 'golang.org/x/text')).toBeDefined();
  });

  it('handles both block and single-line requires together', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require github.com/pkg/errors v0.9.1

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(3);
    expect(deps.find(d => d.name === 'github.com/pkg/errors')).toBeDefined();
    expect(deps.find(d => d.name === 'github.com/gin-gonic/gin')).toBeDefined();
    expect(deps.find(d => d.name === 'github.com/stretchr/testify')).toBeDefined();
  });

  it('all dependencies have production scope', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps.every(d => d.scope === 'production')).toBe(true);
  });

  it('sets declaredConstraint and resolvedVersion to the same value', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require github.com/gin-gonic/gin v1.9.1
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].declaredConstraint).toBe('v1.9.1');
    expect(deps[0].resolvedVersion).toBe('v1.9.1');
  });

  it('skips comment lines in require block', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	// This is a comment
	github.com/gin-gonic/gin v1.9.1
	// Another comment
	github.com/stretchr/testify v1.8.4
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    expect(deps.find(d => d.name === 'github.com/gin-gonic/gin')).toBeDefined();
    expect(deps.find(d => d.name === 'github.com/stretchr/testify')).toBeDefined();
  });

  it('handles indirect dependencies (// indirect comment)', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/sys v0.15.0 // indirect
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    const sys = deps.find(d => d.name === 'golang.org/x/sys');
    expect(sys).toBeDefined();
    expect(sys!.declaredConstraint).toBe('v0.15.0');
  });

  it('handles pseudo-versions', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	github.com/some/module v0.0.0-20230101120000-abcdef123456
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].declaredConstraint).toBe('v0.0.0-20230101120000-abcdef123456');
    expect(deps[0].resolvedVersion).toBe('v0.0.0-20230101120000-abcdef123456');
  });

  it('handles +incompatible versions', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require github.com/some/legacy v3.2.1+incompatible
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].declaredConstraint).toBe('v3.2.1+incompatible');
  });

  it('skips entries with invalid module paths', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	github.com/valid/module v1.0.0
	invalidpath v1.0.0
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('github.com/valid/module');
  });

  it('skips entries with invalid version format', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	github.com/valid/module v1.0.0
	github.com/bad/version 1.0.0
	github.com/bad/version2 latest
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('github.com/valid/module');
  });

  it('returns empty array for unreadable file', async () => {
    const deps = await parseGoManifest('/nonexistent/go.mod', tmpDir);
    expect(deps).toEqual([]);
  });

  it('returns empty array for go.mod with no require directives', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('sets sourceManifest as relative path', async () => {
    const subDir = path.join(tmpDir, 'services', 'api');
    const manifestPath = writeGoMod(`
module github.com/example/api

go 1.21

require github.com/gin-gonic/gin v1.9.1
`, subDir);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].sourceManifest).toBe('services/api/go.mod');
  });

  it('reads go.sum for integrity verification', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require github.com/gin-gonic/gin v1.9.1
`);

    writeGoSum(`github.com/gin-gonic/gin v1.9.1 h1:4idEAncQnU5cB7BeOkPtxjfCSye0AAm1R0RVIqFPSKw=
github.com/gin-gonic/gin v1.9.1/go.mod h1:hPrL/0KcuqOSEXQHxOGZp0Lg2g/4wZIgGMnG3w3gI=
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    // The dependency should still be extracted correctly
    // go.sum is used for integrity verification awareness
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('github.com/gin-gonic/gin');
    expect(deps[0].resolvedVersion).toBe('v1.9.1');
  });

  it('handles go.mod with multiple require blocks', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
)

require (
	golang.org/x/text v0.14.0
	golang.org/x/sys v0.15.0
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(3);
    expect(deps.find(d => d.name === 'github.com/gin-gonic/gin')).toBeDefined();
    expect(deps.find(d => d.name === 'golang.org/x/text')).toBeDefined();
    expect(deps.find(d => d.name === 'golang.org/x/sys')).toBeDefined();
  });

  it('handles empty require block', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('handles pre-release versions', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require github.com/some/module v1.2.3-beta.1
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].declaredConstraint).toBe('v1.2.3-beta.1');
  });

  it('works without go.sum present', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require github.com/gin-gonic/gin v1.9.1
`);

    // No go.sum written
    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('github.com/gin-gonic/gin');
    expect(deps[0].resolvedVersion).toBe('v1.9.1');
  });

  it('sets ecosystem to go for all dependencies', async () => {
    const manifestPath = writeGoMod(`
module github.com/example/myproject

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/text v0.14.0
)
`);

    const deps = await parseGoManifest(manifestPath, tmpDir);

    expect(deps.every(d => d.ecosystem === 'go')).toBe(true);
  });
});
