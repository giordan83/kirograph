/**
 * Unit tests for fix suggestion builder
 */
import { describe, it, expect } from 'vitest';
import { buildFixSuggestion, formatFixSuggestion } from './fix-suggestions';

describe('buildFixSuggestion', () => {
  it('generates npm install command for npm ecosystem', () => {
    expect(buildFixSuggestion('npm', 'express', '4.18.3')).toBe(
      'npm install express@4.18.3',
    );
  });

  it('generates maven update instruction for maven ecosystem with groupId:artifactId', () => {
    expect(
      buildFixSuggestion('maven', 'org.apache.logging.log4j:log4j-core', '2.17.1'),
    ).toBe('Update org.apache.logging.log4j:log4j-core to 2.17.1 in pom.xml');
  });

  it('handles maven package without colon separator', () => {
    expect(buildFixSuggestion('maven', 'log4j-core', '2.17.1')).toBe(
      'Update log4j-core to 2.17.1 in pom.xml',
    );
  });

  it('generates go get command for go ecosystem', () => {
    expect(
      buildFixSuggestion('go', 'github.com/gin-gonic/gin', '1.9.2'),
    ).toBe('go get github.com/gin-gonic/gin@v1.9.2');
  });

  it('generates go get command for golang ecosystem alias', () => {
    expect(
      buildFixSuggestion('golang', 'github.com/gin-gonic/gin', '1.9.2'),
    ).toBe('go get github.com/gin-gonic/gin@v1.9.2');
  });

  it('generates pip install command for pypi ecosystem', () => {
    expect(buildFixSuggestion('pypi', 'django', '4.2.1')).toBe(
      'pip install django==4.2.1',
    );
  });

  it('generates pip install command for pip ecosystem alias', () => {
    expect(buildFixSuggestion('pip', 'requests', '2.31.0')).toBe(
      'pip install requests==2.31.0',
    );
  });

  it('generates cargo update command for cargo ecosystem', () => {
    expect(buildFixSuggestion('cargo', 'serde', '1.0.189')).toBe(
      'cargo update -p serde --precise 1.0.189',
    );
  });

  it('generates generic upgrade message for unknown ecosystem', () => {
    expect(buildFixSuggestion('unknown', 'some-pkg', '2.0.0')).toBe(
      'Upgrade some-pkg to 2.0.0',
    );
  });

  it('is case-insensitive for ecosystem', () => {
    expect(buildFixSuggestion('NPM', 'express', '4.18.3')).toBe(
      'npm install express@4.18.3',
    );
    expect(buildFixSuggestion('Cargo', 'serde', '1.0.189')).toBe(
      'cargo update -p serde --precise 1.0.189',
    );
  });
});

describe('formatFixSuggestion', () => {
  it('returns formatted line with 💡 prefix when fixedVersion is provided', () => {
    const result = formatFixSuggestion('npm', 'express', '4.18.3');
    expect(result).toBe('💡 Fix: npm install express@4.18.3');
  });

  it('returns empty string when fixedVersion is null', () => {
    expect(formatFixSuggestion('npm', 'express', null)).toBe('');
  });

  it('returns empty string when fixedVersion is undefined', () => {
    expect(formatFixSuggestion('npm', 'express', undefined)).toBe('');
  });

  it('returns empty string when fixedVersion is empty string', () => {
    expect(formatFixSuggestion('npm', 'express', '')).toBe('');
  });
});
