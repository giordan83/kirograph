/**
 * Unit tests for the OSV API adapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OsvAdapter } from './osv-adapter';
import { VulnDatabaseError } from '../errors';

describe('OsvAdapter', () => {
  let adapter: OsvAdapter;

  beforeEach(() => {
    adapter = new OsvAdapter({ apiUrl: 'https://api.osv.dev/v1/query' });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has name "OSV"', () => {
    expect(adapter.name).toBe('OSV');
  });

  it('returns empty array for unsupported ecosystem', async () => {
    const result = await adapter.query('unsupported', 'pkg', '1.0.0');
    expect(result).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps npm ecosystem correctly and sends proper request', async () => {
    const mockResponse = { vulns: [] };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await adapter.query('npm', 'express', '4.18.2');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.osv.dev/v1/query',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package: { name: 'express', ecosystem: 'npm' },
          version: '4.18.2',
        }),
      }),
    );
  });

  it('maps maven ecosystem to Maven', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ vulns: [] }), { status: 200 }),
    );

    await adapter.query('maven', 'log4j-core', '2.14.0');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"ecosystem":"Maven"'),
      }),
    );
  });

  it('maps go ecosystem to Go', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ vulns: [] }), { status: 200 }),
    );

    await adapter.query('go', 'github.com/gin-gonic/gin', '1.9.1');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"ecosystem":"Go"'),
      }),
    );
  });

  it('maps pypi ecosystem to PyPI', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ vulns: [] }), { status: 200 }),
    );

    await adapter.query('pypi', 'django', '4.2.0');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"ecosystem":"PyPI"'),
      }),
    );
  });

  it('maps cargo ecosystem to crates.io', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ vulns: [] }), { status: 200 }),
    );

    await adapter.query('cargo', 'serde', '1.0.188');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"ecosystem":"crates.io"'),
      }),
    );
  });

  it('returns empty array when no vulnerabilities found', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const result = await adapter.query('npm', 'express', '4.18.2');
    expect(result).toEqual([]);
  });

  it('parses CVE records from OSV response', async () => {
    const osvResponse = {
      vulns: [
        {
          id: 'GHSA-xxxx-yyyy-zzzz',
          aliases: ['CVE-2023-12345'],
          summary: 'A critical vulnerability in express',
          severity: [{ type: 'CVSS_V3', score: '9.8' }],
          affected: [
            {
              package: { name: 'express', ecosystem: 'npm' },
              ranges: [
                {
                  type: 'ECOSYSTEM',
                  events: [
                    { introduced: '4.0.0' },
                    { fixed: '4.18.3' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(osvResponse), { status: 200 }),
    );

    const result = await adapter.query('npm', 'express', '4.18.2');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'CVE-2023-12345',
      severity: 9.8,
      affectedVersionRanges: [{ introduced: '4.0.0', fixed: '4.18.3' }],
      fixedVersion: '4.18.3',
      summary: 'A critical vulnerability in express',
    });
  });

  it('uses OSV ID when no CVE alias exists', async () => {
    const osvResponse = {
      vulns: [
        {
          id: 'GHSA-abcd-efgh-ijkl',
          aliases: ['PYSEC-2023-001'],
          summary: 'Some vulnerability',
          severity: [{ type: 'CVSS_V3', score: '7.5' }],
          affected: [
            {
              ranges: [
                {
                  type: 'ECOSYSTEM',
                  events: [{ introduced: '1.0.0' }, { fixed: '1.2.0' }],
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(osvResponse), { status: 200 }),
    );

    const result = await adapter.query('npm', 'some-pkg', '1.1.0');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('GHSA-abcd-efgh-ijkl');
  });

  it('truncates summary to 500 characters', async () => {
    const longSummary = 'A'.repeat(600);
    const osvResponse = {
      vulns: [
        {
          id: 'GHSA-test-test-test',
          aliases: ['CVE-2023-99999'],
          summary: longSummary,
          severity: [{ type: 'CVSS_V3', score: '5.0' }],
          affected: [
            {
              ranges: [
                {
                  type: 'ECOSYSTEM',
                  events: [{ introduced: '0' }],
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(osvResponse), { status: 200 }),
    );

    const result = await adapter.query('npm', 'pkg', '1.0.0');

    expect(result[0].summary.length).toBe(500);
    expect(result[0].summary.endsWith('...')).toBe(true);
  });

  it('returns severity 0 when no severity data available', async () => {
    const osvResponse = {
      vulns: [
        {
          id: 'GHSA-no-severity',
          aliases: ['CVE-2023-00001'],
          summary: 'No severity info',
          affected: [
            {
              ranges: [
                {
                  type: 'ECOSYSTEM',
                  events: [{ introduced: '0' }],
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(osvResponse), { status: 200 }),
    );

    const result = await adapter.query('npm', 'pkg', '1.0.0');

    expect(result[0].severity).toBe(0);
  });

  it('extracts multiple affected ranges', async () => {
    const osvResponse = {
      vulns: [
        {
          id: 'GHSA-multi-range',
          aliases: ['CVE-2023-55555'],
          summary: 'Multiple ranges',
          severity: [{ type: 'CVSS_V3', score: '8.0' }],
          affected: [
            {
              ranges: [
                {
                  type: 'ECOSYSTEM',
                  events: [
                    { introduced: '1.0.0' },
                    { fixed: '1.5.0' },
                  ],
                },
                {
                  type: 'ECOSYSTEM',
                  events: [
                    { introduced: '2.0.0' },
                    { fixed: '2.1.0' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(osvResponse), { status: 200 }),
    );

    const result = await adapter.query('npm', 'pkg', '2.0.1');

    expect(result[0].affectedVersionRanges).toHaveLength(2);
    expect(result[0].affectedVersionRanges[0]).toEqual({
      introduced: '1.0.0',
      fixed: '1.5.0',
    });
    expect(result[0].affectedVersionRanges[1]).toEqual({
      introduced: '2.0.0',
      fixed: '2.1.0',
    });
    expect(result[0].fixedVersion).toBe('1.5.0');
  });

  it('handles last_affected in version ranges', async () => {
    const osvResponse = {
      vulns: [
        {
          id: 'GHSA-last-affected',
          aliases: ['CVE-2023-77777'],
          summary: 'Last affected test',
          severity: [{ type: 'CVSS_V3', score: '6.0' }],
          affected: [
            {
              ranges: [
                {
                  type: 'ECOSYSTEM',
                  events: [
                    { introduced: '1.0.0' },
                    { last_affected: '1.9.9' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(osvResponse), { status: 200 }),
    );

    const result = await adapter.query('npm', 'pkg', '1.5.0');

    expect(result[0].affectedVersionRanges[0]).toEqual({
      introduced: '1.0.0',
      lastAffected: '1.9.9',
    });
    expect(result[0].fixedVersion).toBeUndefined();
  });

  it('throws VulnDatabaseError on HTTP error response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    await expect(adapter.query('npm', 'express', '4.18.2')).rejects.toThrow(VulnDatabaseError);
    await expect(adapter.query('npm', 'express', '4.18.2')).rejects.toThrow(/HTTP 500/);
  });

  it('throws VulnDatabaseError on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));

    await expect(adapter.query('npm', 'express', '4.18.2')).rejects.toThrow(VulnDatabaseError);
    await expect(adapter.query('npm', 'express', '4.18.2')).rejects.toThrow(/Network error/);
  });

  it('throws VulnDatabaseError on abort/timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValue(abortError);

    await expect(adapter.query('npm', 'express', '4.18.2')).rejects.toThrow(VulnDatabaseError);
  });

  it('respects external abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValue(abortError);

    await expect(
      adapter.query('npm', 'express', '4.18.2', controller.signal),
    ).rejects.toThrow(VulnDatabaseError);
  });

  it('uses details as fallback when summary is missing', async () => {
    const osvResponse = {
      vulns: [
        {
          id: 'GHSA-details-only',
          aliases: ['CVE-2023-88888'],
          details: 'Detailed description of the vulnerability',
          severity: [{ type: 'CVSS_V3', score: '4.0' }],
          affected: [
            {
              ranges: [
                {
                  type: 'ECOSYSTEM',
                  events: [{ introduced: '0' }],
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(osvResponse), { status: 200 }),
    );

    const result = await adapter.query('npm', 'pkg', '1.0.0');

    expect(result[0].summary).toBe('Detailed description of the vulnerability');
  });

  it('handles case-insensitive ecosystem mapping', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ vulns: [] }), { status: 200 }),
    );

    await adapter.query('NPM', 'express', '4.18.2');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"ecosystem":"npm"'),
      }),
    );
  });

  it('skips vulnerabilities without any identifiable ID', async () => {
    const osvResponse = {
      vulns: [
        {
          id: 'CVE-2023-11111',
          summary: 'Has CVE directly as ID',
          severity: [{ type: 'CVSS_V3', score: '7.0' }],
          affected: [
            {
              ranges: [
                {
                  type: 'ECOSYSTEM',
                  events: [{ introduced: '0' }],
                },
              ],
            },
          ],
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(osvResponse), { status: 200 }),
    );

    const result = await adapter.query('npm', 'pkg', '1.0.0');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('CVE-2023-11111');
  });
});
