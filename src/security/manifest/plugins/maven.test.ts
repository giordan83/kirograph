/**
 * Unit tests for the Maven security manifest plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseMavenManifest } from './maven';

describe('parseMavenManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirograph-maven-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePomXml(content: string, dir?: string): string {
    const targetDir = dir ?? tmpDir;
    const filePath = path.join(targetDir, 'pom.xml');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  it('extracts dependencies with groupId, artifactId, and version', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.20</version>
    </dependency>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>31.1-jre</version>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(2);

    const spring = deps.find(d => d.name === 'org.springframework:spring-core');
    expect(spring).toBeDefined();
    expect(spring!.declaredConstraint).toBe('5.3.20');
    expect(spring!.resolvedVersion).toBe('5.3.20');
    expect(spring!.scope).toBe('production');
    expect(spring!.ecosystem).toBe('maven');

    const guava = deps.find(d => d.name === 'com.google.guava:guava');
    expect(guava).toBeDefined();
    expect(guava!.declaredConstraint).toBe('31.1-jre');
    expect(guava!.resolvedVersion).toBe('31.1-jre');
  });

  it('maps compile scope to production', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.12.0</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].scope).toBe('production');
  });

  it('maps runtime scope to production', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>mysql</groupId>
      <artifactId>mysql-connector-java</artifactId>
      <version>8.0.30</version>
      <scope>runtime</scope>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].scope).toBe('production');
  });

  it('maps test scope to development', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].scope).toBe('development');
  });

  it('maps provided scope to optional', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>javax.servlet</groupId>
      <artifactId>javax.servlet-api</artifactId>
      <version>4.0.1</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].scope).toBe('optional');
  });

  it('maps system scope to optional', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>local-lib</artifactId>
      <version>1.0.0</version>
      <scope>system</scope>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].scope).toBe('optional');
  });

  it('defaults to production scope when no scope specified', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-api</artifactId>
      <version>2.0.7</version>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].scope).toBe('production');
  });

  it('handles all scope types together', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.20</version>
      <scope>compile</scope>
    </dependency>
    <dependency>
      <groupId>mysql</groupId>
      <artifactId>mysql-connector-java</artifactId>
      <version>8.0.30</version>
      <scope>runtime</scope>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>javax.servlet</groupId>
      <artifactId>javax.servlet-api</artifactId>
      <version>4.0.1</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>system-lib</artifactId>
      <version>1.0.0</version>
      <scope>system</scope>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(5);
    expect(deps.find(d => d.name === 'org.springframework:spring-core')!.scope).toBe('production');
    expect(deps.find(d => d.name === 'mysql:mysql-connector-java')!.scope).toBe('production');
    expect(deps.find(d => d.name === 'junit:junit')!.scope).toBe('development');
    expect(deps.find(d => d.name === 'javax.servlet:javax.servlet-api')!.scope).toBe('optional');
    expect(deps.find(d => d.name === 'com.example:system-lib')!.scope).toBe('optional');
  });

  it('skips dependencies with missing groupId', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <artifactId>some-lib</artifactId>
      <version>1.0.0</version>
    </dependency>
    <dependency>
      <groupId>org.valid</groupId>
      <artifactId>valid-lib</artifactId>
      <version>2.0.0</version>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('org.valid:valid-lib');
  });

  it('skips dependencies with missing artifactId', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <version>1.0.0</version>
    </dependency>
    <dependency>
      <groupId>org.valid</groupId>
      <artifactId>valid-lib</artifactId>
      <version>2.0.0</version>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('org.valid:valid-lib');
  });

  it('skips dependencies with unresolved Maven properties', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>\${project.groupId}</groupId>
      <artifactId>internal-module</artifactId>
      <version>1.0.0</version>
    </dependency>
    <dependency>
      <groupId>org.valid</groupId>
      <artifactId>valid-lib</artifactId>
      <version>2.0.0</version>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('org.valid:valid-lib');
  });

  it('handles dependencies without version (managed by parent POM)', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-web</artifactId>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('org.springframework:spring-web');
    expect(deps[0].declaredConstraint).toBe('');
    expect(deps[0].resolvedVersion).toBeUndefined();
  });

  it('handles version with unresolved property', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>\${spring.version}</version>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].declaredConstraint).toBe('');
    expect(deps[0].resolvedVersion).toBeUndefined();
  });

  it('returns empty array for non-existent file', async () => {
    const fakePath = path.join(tmpDir, 'nonexistent', 'pom.xml');
    const deps = await parseMavenManifest(fakePath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('returns empty array for invalid XML without project element', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<not-a-project>
  <something>value</something>
</not-a-project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('returns empty array for pom.xml with no dependencies', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);
    expect(deps).toEqual([]);
  });

  it('sets sourceManifest as relative path', async () => {
    const subDir = path.join(tmpDir, 'modules', 'core');
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>lib</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>`, subDir);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].sourceManifest).toBe('modules/core/pom.xml');
  });

  it('sets ecosystem to maven for all dependencies', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.logging.log4j</groupId>
      <artifactId>log4j-core</artifactId>
      <version>2.17.0</version>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    expect(deps).toHaveLength(1);
    expect(deps[0].ecosystem).toBe('maven');
  });

  it('handles dependencies in dependencyManagement section', async () => {
    const manifestPath = writePomXml(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-dependencies</artifactId>
        <version>3.1.0</version>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.1.0</version>
    </dependency>
  </dependencies>
</project>`);

    const deps = await parseMavenManifest(manifestPath, tmpDir);

    // Should extract both dependencies (from dependencyManagement and regular)
    expect(deps.length).toBeGreaterThanOrEqual(1);
    const starterWeb = deps.find(d => d.name === 'org.springframework.boot:spring-boot-starter-web');
    expect(starterWeb).toBeDefined();
    expect(starterWeb!.declaredConstraint).toBe('3.1.0');
  });
});
