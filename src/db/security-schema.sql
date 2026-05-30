-- KiroGraph Security Schema (opt-in, enableSecurity=true)
-- Extends the core graph with dependency vulnerability and reachability data.

-- Dependency nodes (extends the nodes table with additional metadata)
CREATE TABLE IF NOT EXISTS sec_dependencies (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  ecosystem TEXT NOT NULL,          -- npm, maven, go, pypi, cargo, nuget, rubygems, ...
  package_name TEXT NOT NULL,
  declared_constraint TEXT NOT NULL,
  resolved_version TEXT,
  scope TEXT NOT NULL DEFAULT 'production',  -- production, development, optional
  transitive_status TEXT DEFAULT 'complete', -- complete, incomplete
  last_vuln_check INTEGER,          -- epoch ms of last vulnerability query
  vuln_data_stale INTEGER DEFAULT 0, -- boolean flag
  vuln_data_stale_since INTEGER,    -- epoch ms when data became stale
  source_manifests TEXT NOT NULL,   -- JSON array of declaring manifest paths
  license TEXT,                     -- SPDX identifier (e.g. "MIT", "Apache-2.0") or NULL
  latest_version TEXT,              -- newest published version from registry
  latest_published INTEGER,         -- epoch ms of latest version publish date
  staleness_score REAL              -- 0.0–1.0: 0 = current, 1 = very stale
);

CREATE INDEX IF NOT EXISTS idx_sec_deps_ecosystem ON sec_dependencies(ecosystem);
CREATE INDEX IF NOT EXISTS idx_sec_deps_name ON sec_dependencies(package_name);
CREATE INDEX IF NOT EXISTS idx_sec_deps_scope ON sec_dependencies(scope);
CREATE INDEX IF NOT EXISTS idx_sec_deps_license ON sec_dependencies(license);
CREATE INDEX IF NOT EXISTS idx_sec_deps_staleness ON sec_dependencies(staleness_score);

-- Vulnerability nodes (extends the nodes table with CVE metadata)
CREATE TABLE IF NOT EXISTS sec_vulnerabilities (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  cve_id TEXT NOT NULL UNIQUE,
  severity_score REAL,              -- CVSS v3.1 base score (0.0–10.0)
  epss_score REAL,                  -- EPSS exploitation probability (0.0–1.0)
  epss_percentile REAL,             -- EPSS percentile among all CVEs (0.0–1.0)
  epss_fetched_at INTEGER,          -- epoch ms of last EPSS fetch
  affected_ranges TEXT NOT NULL,    -- JSON array of VersionRange objects
  fixed_version TEXT,
  summary TEXT,                     -- truncated to 500 chars
  source_database TEXT NOT NULL,    -- which database provided this record
  risk_score REAL,                  -- combined risk score 0.0–10.0 (reachability × CVSS × EPSS × staleness)
  first_detected_at INTEGER,        -- epoch ms when first added to our DB
  fix_available_since INTEGER,      -- epoch ms when fixed_version was first known
  suppressed_at INTEGER,            -- epoch ms when suppressed (NULL if not)
  remediated_at INTEGER             -- epoch ms when no longer present (fixed)
);

CREATE INDEX IF NOT EXISTS idx_sec_vulns_cve ON sec_vulnerabilities(cve_id);
CREATE INDEX IF NOT EXISTS idx_sec_vulns_severity ON sec_vulnerabilities(severity_score);
CREATE INDEX IF NOT EXISTS idx_sec_vulns_epss ON sec_vulnerabilities(epss_score);
CREATE INDEX IF NOT EXISTS idx_sec_vulns_risk ON sec_vulnerabilities(risk_score);

-- Reachability analysis results
CREATE TABLE IF NOT EXISTS sec_reachability (
  vulnerability_node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,            -- affected, not_affected, under_investigation
  paths TEXT,                       -- JSON array of ReachabilityPath objects
  unresolved_symbols TEXT,          -- JSON array of symbol IDs (up to 50)
  reaching_entry_point_count INTEGER DEFAULT 0,
  analyzed_at INTEGER NOT NULL      -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_sec_reach_verdict ON sec_reachability(verdict);

-- Impact analysis results (only for affected vulnerabilities)
CREATE TABLE IF NOT EXISTS sec_impact (
  vulnerability_node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  affected_layers TEXT,             -- JSON array of layer names
  affected_entry_points TEXT,       -- JSON array of node IDs
  distinct_path_count INTEGER DEFAULT 0,
  analyzed_at INTEGER NOT NULL
);
