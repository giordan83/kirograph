/**
 * Unit tests for the pip security manifest plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parsePipManifest } from './pip';

describe('parsePipManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirograph-pip-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRequirements(content: string, filename = 'requirements.txt'): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  it('extracts packages with == constraint and resolves exact version', async () => {
    const manifestPath = writeRequirements('flask==2.3.0\nrequests==2.28.1\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    const flask = deps.find(d => d.name === 'flask');
    expect(flask).toBeDefined();
    expect(flask!.declaredConstraint).toBe('==2.3.0');
    expect(flask!.resolvedVersion).toBe('2.3.0');
    expect(flask!.scope).toBe('production');
    expect(flask!.ecosystem).toBe('pypi');

    const requests = deps.find(d => d.name === 'requests');
    expect(requests).toBeDefined();
    expect(requests!.declaredConstraint).toBe('==2.28.1');
    expect(requests!.resolvedVersion).toBe('2.28.1');
  });

  it('extracts packages with >= constraint (no resolved version)', async () => {
    const manifestPath = writeRequirements('requests>=2.28\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('requests');
    expect(deps[0].declaredConstraint).toBe('>=2.28');
    expect(deps[0].resolvedVersion).toBeUndefined();
  });

  it('extracts packages with ~= constraint', async () => {
    const manifestPath = writeRequirements('django~=4.2\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('django');
    expect(deps[0].declaredConstraint).toBe('~=4.2');
    expect(deps[0].resolvedVersion).toBeUndefined();
  });

  it('extracts packages with no version constraint', async () => {
    const manifestPath = writeRequirements('numpy\nscipy\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    expect(deps[0].name).toBe('numpy');
    expect(deps[0].declaredConstraint).toBe('');
    expect(deps[0].resolvedVersion).toBeUndefined();
    expect(deps[1].name).toBe('scipy');
  });

  it('skips comment lines', async () => {
    const manifestPath = writeRequirements(
      '# This is a comment\nflask==2.3.0\n# Another comment\nrequests>=2.28\n',
    );

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    expect(deps.map(d => d.name)).toEqual(['flask', 'requests']);
  });

  it('skips empty lines', async () => {
    const manifestPath = writeRequirements('flask==2.3.0\n\n\nrequests>=2.28\n\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
  });

  it('skips pip option lines (-r, -c, -e, --index-url, --extra-index-url)', async () => {
    const manifestPath = writeRequirements(
      '-r base.txt\n-c constraints.txt\n-e git+https://github.com/user/repo.git\n--index-url https://pypi.org/simple\n--extra-index-url https://private.pypi.org/simple\nflask==2.3.0\n',
    );

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('flask');
  });

  it('strips environment markers', async () => {
    const manifestPath = writeRequirements(
      'pywin32>=300; sys_platform == "win32"\ncolorama>=0.4; os_name == "nt"\nflask==2.3.0\n',
    );

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(3);
    const pywin32 = deps.find(d => d.name === 'pywin32');
    expect(pywin32).toBeDefined();
    expect(pywin32!.declaredConstraint).toBe('>=300');

    const colorama = deps.find(d => d.name === 'colorama');
    expect(colorama).toBeDefined();
    expect(colorama!.declaredConstraint).toBe('>=0.4');
  });

  it('handles packages with extras (e.g. package[extra]>=1.0)', async () => {
    const manifestPath = writeRequirements('requests[security]>=2.28.0\ncelery[redis]==5.3.0\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    const requests = deps.find(d => d.name === 'requests');
    expect(requests).toBeDefined();
    expect(requests!.declaredConstraint).toBe('>=2.28.0');

    const celery = deps.find(d => d.name === 'celery');
    expect(celery).toBeDefined();
    expect(celery!.declaredConstraint).toBe('==5.3.0');
    expect(celery!.resolvedVersion).toBe('5.3.0');
  });

  it('normalizes package names (PEP 503)', async () => {
    const manifestPath = writeRequirements(
      'Flask==2.3.0\nPyYAML>=6.0\nmy_package==1.0.0\nAnother.Package>=2.0\n',
    );

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(4);
    expect(deps.map(d => d.name)).toEqual([
      'flask',
      'pyyaml',
      'my-package',
      'another-package',
    ]);
  });

  it('all dependencies have production scope', async () => {
    const manifestPath = writeRequirements('flask==2.3.0\npytest==7.0.0\nmypy>=1.0\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(3);
    expect(deps.every(d => d.scope === 'production')).toBe(true);
  });

  it('all dependencies have pypi ecosystem', async () => {
    const manifestPath = writeRequirements('flask==2.3.0\ndjango~=4.2\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps.every(d => d.ecosystem === 'pypi')).toBe(true);
  });

  it('sets sourceManifest as relative path', async () => {
    const subDir = path.join(tmpDir, 'services', 'api');
    fs.mkdirSync(subDir, { recursive: true });
    const filePath = path.join(subDir, 'requirements.txt');
    fs.writeFileSync(filePath, 'flask==2.3.0\n');

    const deps = await parsePipManifest(filePath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].sourceManifest).toBe('services/api/requirements.txt');
  });

  it('returns empty array for non-existent file', async () => {
    const deps = await parsePipManifest(
      path.join(tmpDir, 'nonexistent.txt'),
      tmpDir,
    );
    expect(deps).toEqual([]);
  });

  it('handles inline comments', async () => {
    const manifestPath = writeRequirements(
      'flask==2.3.0  # web framework\nrequests>=2.28 # HTTP library\n',
    );

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    expect(deps[0].declaredConstraint).toBe('==2.3.0');
    expect(deps[1].declaredConstraint).toBe('>=2.28');
  });

  it('handles compound version constraints (e.g. >=1.0,<2.0)', async () => {
    const manifestPath = writeRequirements('flask>=2.0,<3.0\nrequests>=2.28,!=2.29.0\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    expect(deps[0].name).toBe('flask');
    expect(deps[0].declaredConstraint).toBe('>=2.0,<3.0');
    expect(deps[0].resolvedVersion).toBeUndefined();

    expect(deps[1].name).toBe('requests');
    expect(deps[1].declaredConstraint).toBe('>=2.28,!=2.29.0');
  });

  it('handles != constraint', async () => {
    const manifestPath = writeRequirements('flask!=2.2.0\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].declaredConstraint).toBe('!=2.2.0');
    expect(deps[0].resolvedVersion).toBeUndefined();
  });

  it('handles < and > constraints', async () => {
    const manifestPath = writeRequirements('flask>2.0\ndjango<5.0\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);
    expect(deps[0].declaredConstraint).toBe('>2.0');
    expect(deps[1].declaredConstraint).toBe('<5.0');
  });

  it('handles <= constraint', async () => {
    const manifestPath = writeRequirements('flask<=2.3.0\n');

    const deps = await parsePipManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].declaredConstraint).toBe('<=2.3.0');
  });
});
