import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Command } from 'commander';
import { bold, dim, green, reset, violet } from '../ui';

function openBrowser(filePath: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start'
            : 'xdg-open';
  spawn(cmd, [filePath], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

async function generateExport(
  projectPath: string | undefined,
  opts: { output?: string; includeContains: boolean },
): Promise<string> {
  const KiroGraph = (await import('../../index')).default;
  const target = path.resolve(projectPath ?? process.cwd());
  const cg = await KiroGraph.open(target);

  const nodes = cg.getAllNodes();
  const edges = cg.getAllEdges();
  cg.close();

  const projectName = path.basename(target);

  // Embed logo as base64 if it exists next to this package
  let logoBase64: string | undefined;
  const logoCandidates = [
    path.join(__dirname, '../../assets/logo.png'),         // dist layout
    path.join(__dirname, '../../../assets/logo.png'),      // src layout (dev)
  ];
  for (const p of logoCandidates) {
    if (fs.existsSync(p)) {
      logoBase64 = fs.readFileSync(p).toString('base64');
      break;
    }
  }

  const html = buildHtml(nodes, edges, projectName, opts.includeContains, logoBase64);

  const outPath = opts.output
    ? path.resolve(opts.output)
    : path.join(target, '.kirograph', 'kirograph.html');
  fs.writeFileSync(outPath, html, 'utf8');

  const edgeCount = opts.includeContains
    ? edges.length
    : edges.filter((e: any) => e.kind !== 'contains').length;

  console.log();
  console.log(`  ${violet}${bold}Graph exported${reset}`);
  console.log(`  ${dim}nodes   ${reset}${bold}${nodes.length}${reset}`);
  console.log(`  ${dim}edges   ${reset}${bold}${edgeCount}${reset}${opts.includeContains ? '' : dim + '  (contains edges excluded)' + reset}`);
  console.log(`  ${dim}output  ${reset}${green}${outPath}${reset}`);
  console.log();

  return outPath;
}

// ── Color palettes ────────────────────────────────────────────────────────────
const KIND_COLOR: Record<string, string> = {
  class:       '#9b59b6',
  struct:      '#8e44ad',
  interface:   '#6c3483',
  trait:       '#7d3c98',
  protocol:    '#6c3483',
  function:    '#5b6abf',
  method:      '#7986cb',
  component:   '#26a69a',
  route:       '#2e7d32',
  variable:    '#546e7a',
  constant:    '#455a64',
  property:    '#607d8b',
  field:       '#78909c',
  enum:        '#e67e22',
  enum_member: '#f39c12',
  type_alias:  '#00838f',
  namespace:   '#00695c',
  parameter:   '#616161',
  import:      '#37474f',
  export:      '#37474f',
  file:        '#263238',
  module:      '#1c313a',
};

const EDGE_COLOR: Record<string, string> = {
  calls:        '#7986cb',
  imports:      '#546e7a',
  exports:      '#546e7a',
  extends:      '#ab47bc',
  implements:   '#8e24aa',
  references:   '#455a64',
  type_of:      '#00838f',
  returns:      '#0277bd',
  instantiates: '#6a1b9a',
  overrides:    '#ad1457',
  decorates:    '#e67e22',
  contains:     '#263238',
};

const EDGE_DASHED: Record<string, boolean> = {
  imports:    true,
  references: true,
  type_of:    true,
  returns:    true,
};

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + 60);
  const g = Math.min(255, ((n >> 8)  & 0xff) + 60);
  const b = Math.min(255, ( n        & 0xff) + 60);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(nodes: any[], edges: any[], projectName: string, includeContains: boolean, logoBase64?: string): string {
  const filteredEdges = includeContains ? edges : edges.filter(e => e.kind !== 'contains');

  const degree = new Map<string, number>();
  for (const e of filteredEdges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const maxDegree = Math.max(0, ...degree.values());

  const visNodes = nodes.map(n => ({
    id:           n.id,
    label:        n.name,
    color: {
      background: KIND_COLOR[n.kind] ?? '#424242',
      border:     lighten(KIND_COLOR[n.kind] ?? '#424242'),
      highlight:  { background: '#e040fb', border: '#ea80fc' },
      hover:      { background: lighten(KIND_COLOR[n.kind] ?? '#424242'), border: '#ea80fc' },
    },
    size:         Math.max(8, Math.min(40, 8 + (degree.get(n.id) ?? 0) * 1.5)),
    font:         { size: 11, color: '#e0e0e0', face: 'monospace' },
    kind:         n.kind,
    filePath:     n.filePath,
    startLine:    n.startLine,
    qualifiedName: n.qualifiedName,
    signature:    n.signature ?? null,
    isExported:   n.isExported ?? false,
    degree:       degree.get(n.id) ?? 0,
    borderWidth:  n.isExported ? 2 : 1,
    borderWidthSelected: 3,
  }));

  const visEdges = filteredEdges.map((e: any, i: number) => ({
    id:     i,
    ekind:  e.kind,
    from:   e.source,
    to:     e.target,
    label:  e.kind,
    dashes: EDGE_DASHED[e.kind] ?? false,
    color:  { color: EDGE_COLOR[e.kind] ?? '#546e7a', opacity: e.kind === 'contains' ? 0.2 : 0.6 },
    width:  ['extends', 'implements', 'calls'].includes(e.kind) ? 2 : 1,
    font:   { size: 9, color: '#546e7a', align: 'middle' },
    arrows: e.kind !== 'contains' ? { to: { enabled: true, scaleFactor: 0.5 } } : {},
    smooth: { type: 'curvedCW', roundness: 0.1 },
  }));

  const allNodeKinds  = [...new Set(nodes.map((n: any) => n.kind))].sort();
  const allEdgeKinds  = [...new Set(filteredEdges.map((e: any) => e.kind))].sort();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KiroGraph — ${escHtml(projectName)}</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #0a0a0f;
  color: #e0e0e0;
  font-family: 'SF Mono','Fira Code','Consolas',monospace;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ── Header ── */
#header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #12121a;
  border-bottom: 1px solid #1e1e2e;
  flex-shrink: 0;
  z-index: 10;
}
#header h1 { font-size: 13px; font-weight: 600; color: #c792ea; letter-spacing: .05em; white-space: nowrap; }
.sep { color: #2a2a3e; }
#stats { color: #546e7a; font-size: 11px; white-space: nowrap; }
#proj  { color: #37474f; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

#search {
  margin-left: auto;
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  border-radius: 6px;
  color: #e0e0e0;
  padding: 4px 10px;
  font-family: inherit;
  font-size: 12px;
  width: 200px;
  outline: none;
  transition: border-color .2s;
}
#search:focus { border-color: #7986cb; }
#search::placeholder { color: #37474f; }

.btn {
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  border-radius: 5px;
  color: #90a4ae;
  padding: 4px 9px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}
.btn:hover  { border-color: #7986cb; color: #e0e0e0; }
.btn.active { border-color: #7986cb; color: #c792ea; background: #1e1e3a; }
.btn.warn   { border-color: #e67e22; color: #e67e22; }

/* ── Main ── */
#main { display: flex; flex: 1; overflow: hidden; position: relative; }
#graph { flex: 1; background: #0a0a0f; }

/* ── Loader ── */
#loader {
  display: none;
  position: absolute;
  inset: 0;
  background: rgba(10,10,15,.55);
  backdrop-filter: blur(2px);
  z-index: 200;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.spinner {
  width: 26px; height: 26px;
  border: 3px solid #1e1e2e;
  border-top-color: #c792ea;
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Path mode bar ── */
#path-bar {
  display: none;
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: #12121a;
  border: 1px solid #7986cb;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 12px;
  color: #c792ea;
  z-index: 50;
  pointer-events: none;
  box-shadow: 0 4px 20px rgba(0,0,0,.6);
}

/* ── Side panel ── */
#panel {
  width: 280px;
  background: #12121a;
  border-left: 1px solid #1e1e2e;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
  transition: width .2s;
}
body.fullscreen #panel { width: 0; border: none; }

#panel-tabs { display: flex; border-bottom: 1px solid #1e1e2e; flex-shrink: 0; }
.tab {
  flex: 1; padding: 8px; text-align: center;
  font-size: 11px; color: #546e7a; cursor: pointer;
  border-bottom: 2px solid transparent; transition: all .15s;
}
.tab.active { color: #c792ea; border-bottom-color: #c792ea; }
#panel-content { flex: 1; overflow-y: auto; padding: 12px; }

/* ── Detail tab ── */
.detail-empty { color: #37474f; font-size: 12px; padding: 8px 0; }
.detail-name  { font-size: 15px; font-weight: 600; color: #c792ea; margin-bottom: 4px; word-break: break-all; }
.detail-kind  {
  display: inline-block; font-size: 10px; padding: 2px 7px;
  border-radius: 10px; background: #1e1e2e; color: #7986cb; margin-bottom: 10px;
}
.detail-row   { display: flex; gap: 8px; margin-bottom: 5px; font-size: 11px; }
.detail-label { color: #37474f; min-width: 60px; flex-shrink: 0; }
.detail-val   { color: #90a4ae; word-break: break-all; }
.detail-sig   {
  margin-top: 8px; background: #0d0d1a; border: 1px solid #1e1e2e;
  border-radius: 5px; padding: 8px; font-size: 11px; color: #7986cb;
  word-break: break-all; white-space: pre-wrap;
}
.detail-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.action-btn {
  background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 4px;
  color: #7986cb; padding: 4px 8px; font-size: 11px; cursor: pointer;
  font-family: inherit; transition: all .15s;
}
.action-btn:hover { border-color: #7986cb; color: #e0e0e0; }

/* ── History breadcrumb ── */
#history-nav {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 10px; padding-bottom: 10px;
  border-bottom: 1px solid #1e1e2e;
}
.hist-btn {
  background: none; border: 1px solid #2a2a3e; border-radius: 4px;
  color: #546e7a; padding: 2px 7px; font-size: 12px; cursor: pointer;
  transition: all .15s;
}
.hist-btn:not(:disabled):hover { border-color: #7986cb; color: #e0e0e0; }
.hist-btn:disabled { opacity: 0.3; cursor: default; }
#hist-label { font-size: 10px; color: #37474f; flex: 1; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Path result ── */
.path-result { margin-top: 10px; }
.path-step {
  display: flex; align-items: flex-start; gap: 6px;
  margin-bottom: 2px; font-size: 11px;
}
.path-step-num  { color: #37474f; min-width: 18px; text-align: right; flex-shrink: 0; }
.path-step-name { color: #c792ea; font-weight: 600; cursor: pointer; }
.path-step-name:hover { text-decoration: underline; }
.path-step-kind { color: #546e7a; }
.path-connector { color: #2a2a3e; margin-left: 22px; font-size: 10px; margin-bottom: 2px; }

/* ── Legend tab ── */
.legend-section { margin-bottom: 14px; }
.legend-title   { font-size: 10px; color: #546e7a; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 7px; }
.legend-item    {
  display: flex; align-items: center; gap: 7px; margin-bottom: 3px;
  font-size: 11px; color: #90a4ae; cursor: pointer; padding: 2px 4px;
  border-radius: 4px; transition: background .1s;
}
.legend-item:hover  { background: #1a1a2e; }
.legend-item.dimmed { opacity: .3; }
.legend-dot  { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.legend-line { width: 18px; height: 2px; flex-shrink: 0; }
.legend-count{ margin-left: auto; color: #37474f; font-size: 10px; }

/* ── Filters tab ── */
.filter-section { margin-bottom: 18px; }
.filter-label   { font-size: 10px; color: #546e7a; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
.filter-value   { color: #c792ea; font-size: 12px; }
input[type=range] {
  width: 100%; accent-color: #7986cb;
  background: transparent; cursor: pointer;
}
.filter-hint { font-size: 10px; color: #37474f; margin-top: 5px; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 3px; }

/* ── Tooltip ── */
.vis-tooltip {
  background: #12121a !important; border: 1px solid #2a2a3e !important;
  color: #e0e0e0 !important; font-family: 'SF Mono','Fira Code',monospace !important;
  font-size: 12px !important; border-radius: 6px !important; padding: 8px 10px !important;
}
</style>
</head>
<body>

<div id="header">
  ${logoBase64
    ? `<img src="data:image/png;base64,${logoBase64}" alt="KiroGraph" style="height:32px;width:auto;object-fit:contain;flex-shrink:0">`
    : `<h1>⬡ KiroGraph</h1>`}
  <span class="sep">·</span>
  <span id="stats">${visNodes.length} nodes · ${visEdges.length} edges</span>
  <span class="sep">·</span>
  <span id="proj">${escHtml(projectName)}</span>
  <input id="search" type="text" placeholder="Search symbols…">
  <button class="btn active" id="btn-fit"      title="Fit graph to view">⊞ Fit</button>
  <button class="btn active" id="btn-physics"  title="Toggle physics simulation">⚡ Physics</button>
  <button class="btn"        id="btn-focus"    title="Focus on selected node and its neighbors">◎ Focus</button>
  <button class="btn"        id="btn-path"     title="Find and highlight path between two nodes">⟶ Path</button>
  <button class="btn"        id="btn-png"      title="Export graph as PNG image">📷 PNG</button>
  <button class="btn"        id="btn-fullscreen" title="Toggle fullscreen graph">⛶</button>
</div>

<div id="main">
  <div id="loader"><div class="spinner"></div></div>
  <div id="path-bar">Click a node to set start…</div>
  <div id="graph"></div>

  <div id="panel">
    <div id="panel-tabs">
      <div class="tab active" data-tab="detail">Detail</div>
      <div class="tab"        data-tab="legend">Legend</div>
      <div class="tab"        data-tab="filters">Filters</div>
    </div>
    <div id="panel-content">

      <!-- Detail tab -->
      <div id="tab-detail">
        <div id="history-nav">
          <button class="hist-btn" id="hist-back"    disabled>‹</button>
          <span   id="hist-label">no selection</span>
          <button class="hist-btn" id="hist-forward" disabled>›</button>
        </div>
        <p class="detail-empty">Click a node to inspect it.</p>
      </div>

      <!-- Legend tab -->
      <div id="tab-legend" style="display:none">
        <div class="legend-section">
          <div class="legend-title">Node kinds <span style="color:#37474f;font-size:9px">(click to toggle)</span></div>
          ${allNodeKinds.map(k => `<div class="legend-item" data-nkind="${k}">
            <div class="legend-dot" style="background:${KIND_COLOR[k] ?? '#424242'}"></div>
            <span>${k}</span>
            <span class="legend-count">${nodes.filter((n: any) => n.kind === k).length}</span>
          </div>`).join('')}
        </div>
        <div class="legend-section">
          <div class="legend-title">Edge kinds <span style="color:#37474f;font-size:9px">(click to toggle)</span></div>
          ${allEdgeKinds.map(k => `<div class="legend-item" data-ekind="${k}">
            <div class="legend-line" style="${EDGE_DASHED[k] ? `border-top:2px dashed ${EDGE_COLOR[k] ?? '#546e7a'};height:0` : `background:${EDGE_COLOR[k] ?? '#546e7a'}`}"></div>
            <span>${k}</span>
            <span class="legend-count">${filteredEdges.filter((e: any) => e.kind === k).length}</span>
          </div>`).join('')}
        </div>
      </div>

      <!-- Filters tab -->
      <div id="tab-filters" style="display:none">
        <div class="filter-section">
          <div class="filter-label">
            Min degree
            <span class="filter-value" id="degree-val">0</span>
          </div>
          <input type="range" id="degree-slider" min="0" max="${maxDegree}" value="0" step="1">
          <div class="filter-hint">Hide nodes with fewer than N connections. Use to surface the most-connected symbols.</div>
        </div>
      </div>

    </div>
  </div>
</div>

<script>
// ── Data ──────────────────────────────────────────────────────────────────────
const NODES_DATA   = ${JSON.stringify(visNodes)};
const EDGES_DATA   = ${JSON.stringify(visEdges)};
const KIND_COLORS  = ${JSON.stringify(KIND_COLOR)};
const EDGE_COLORS  = ${JSON.stringify(EDGE_COLOR)};

const nodesDS = new vis.DataSet(NODES_DATA);
const edgesDS = new vis.DataSet(EDGES_DATA);

// ── Precomputed lookups ───────────────────────────────────────────────────────
const nodeById = {};
NODES_DATA.forEach(n => { nodeById[n.id] = n; });

// Adjacency map (undirected) for focus + path BFS
const adj = {};
EDGES_DATA.forEach(e => {
  if (!adj[e.from]) adj[e.from] = new Set();
  if (!adj[e.to])   adj[e.to]   = new Set();
  adj[e.from].add(e.to);
  adj[e.to].add(e.from);
});

// Edge lookup for path edge highlighting: "fromId|toId" -> edge id
const edgeMap = {};
EDGES_DATA.forEach(e => {
  edgeMap[e.from + '|' + e.to] = e.id;
  edgeMap[e.to + '|' + e.from] = e.id;
});

// Original colors for path restore
const originalColors = {};
NODES_DATA.forEach(n => { originalColors[n.id] = n.color; });
const originalEdgeColors = {};
EDGES_DATA.forEach(e => { originalEdgeColors[e.id] = e.color; });

// ── Filter state ──────────────────────────────────────────────────────────────
const hiddenNodeKinds = new Set();
const hiddenEdgeKinds = new Set();
let minDegree   = 0;
let focusActive = false;
let focusSet    = new Set(); // node ids in focus (focal + neighbors)
let searchActive = false;
let searchIds   = new Set();
let pathHighlightActive = false;

// ── Path mode state ───────────────────────────────────────────────────────────
let pathMode = false;
let pathStep = 0;       // 0=idle, 1=awaiting from, 2=awaiting to
let pathFromId = null;
let pathToId   = null;

// ── History state ─────────────────────────────────────────────────────────────
const navHistory = [];
let histIdx = -1;

// ── vis.js network ────────────────────────────────────────────────────────────
const network = new vis.Network(
  document.getElementById('graph'),
  { nodes: nodesDS, edges: edgesDS },
  {
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: { gravitationalConstant: -80, centralGravity: 0.005, springLength: 120, springConstant: 0.08, damping: 0.6, avoidOverlap: 0.6 },
      stabilization: { iterations: 250, fit: true },
    },
    interaction: { hover: true, tooltipDelay: 150, hideEdgesOnDrag: true, multiselect: false },
    nodes: { shape: 'dot', scaling: { min: 6, max: 40 }, shadow: { enabled: true, color: 'rgba(0,0,0,.6)', size: 8, x: 2, y: 2 } },
    edges: { smooth: { type: 'continuous' }, selectionWidth: 2, hoverWidth: 1.5 },
    layout: { improvedLayout: false },
  }
);

// ── Central filter ────────────────────────────────────────────────────────────
function applyFilters(skipLoader) {
  withLoader(skipLoader, () => {
    const nodeUpdates = [];
    const edgeUpdates = [];

    NODES_DATA.forEach(n => {
      let hidden = false;
      if (hiddenNodeKinds.has(n.kind))              hidden = true;
      else if (n.degree < minDegree)                hidden = true;
      else if (focusActive && !focusSet.has(n.id))  hidden = true;
      else if (searchActive && !searchIds.has(n.id)) hidden = true;
      nodeUpdates.push({ id: n.id, hidden });
    });

    EDGES_DATA.forEach(e => {
      let hidden = hiddenEdgeKinds.has(e.ekind);
      edgeUpdates.push({ id: e.id, hidden });
    });

    nodesDS.update(nodeUpdates);
    edgesDS.update(edgeUpdates);
  });
}

// ── Loader helper ─────────────────────────────────────────────────────────────
function withLoader(skip, fn) {
  const loader = document.getElementById('loader');
  if (skip) { fn(); return; }
  loader.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => { fn(); loader.style.display = 'none'; }));
}

// ── Panel tabs ────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const t = tab.dataset.tab;
    document.getElementById('tab-detail').style.display  = t === 'detail'  ? '' : 'none';
    document.getElementById('tab-legend').style.display  = t === 'legend'  ? '' : 'none';
    document.getElementById('tab-filters').style.display = t === 'filters' ? '' : 'none';
  });
});

// ── History ───────────────────────────────────────────────────────────────────
function pushHistory(nodeId) {
  navHistory.splice(histIdx + 1);
  navHistory.push(nodeId);
  if (navHistory.length > 50) navHistory.shift();
  histIdx = navHistory.length - 1;
  updateHistoryNav();
}

function updateHistoryNav() {
  const n = nodeById[navHistory[histIdx]];
  document.getElementById('hist-label').textContent   = n ? n.label : 'no selection';
  document.getElementById('hist-back').disabled    = histIdx <= 0;
  document.getElementById('hist-forward').disabled = histIdx >= navHistory.length - 1;
}

document.getElementById('hist-back').addEventListener('click', () => {
  if (histIdx > 0) { histIdx--; updateHistoryNav(); showDetail(navHistory[histIdx], false); network.selectNodes([navHistory[histIdx]]); }
});
document.getElementById('hist-forward').addEventListener('click', () => {
  if (histIdx < navHistory.length - 1) { histIdx++; updateHistoryNav(); showDetail(navHistory[histIdx], false); network.selectNodes([navHistory[histIdx]]); }
});

// ── Detail panel ──────────────────────────────────────────────────────────────
function showDetail(nodeId, addToHistory) {
  if (addToHistory !== false) pushHistory(nodeId);
  const n = nodeById[nodeId];
  if (!n) return;

  const vscodeUri = \`vscode://file/\${n.filePath}:\${n.startLine}\`;
  const copyRef   = \`\${n.filePath}:\${n.startLine}\`;

  document.getElementById('tab-detail').innerHTML = \`
    <div id="history-nav">
      <button class="hist-btn" id="hist-back"    \${histIdx <= 0 ? 'disabled' : ''}>‹</button>
      <span   id="hist-label" title="\${esc(n.label)}">\${esc(n.label)}</span>
      <button class="hist-btn" id="hist-forward" \${histIdx >= navHistory.length - 1 ? 'disabled' : ''}>›</button>
    </div>
    <div class="detail-name">\${esc(n.label)}</div>
    <span class="detail-kind">\${esc(n.kind)}</span>
    <div class="detail-row"><span class="detail-label">file</span><span class="detail-val">\${esc(n.filePath)}:\${n.startLine}</span></div>
    \${n.qualifiedName !== n.label ? \`<div class="detail-row"><span class="detail-label">qualified</span><span class="detail-val">\${esc(n.qualifiedName)}</span></div>\` : ''}
    <div class="detail-row"><span class="detail-label">degree</span><span class="detail-val">\${n.degree} connections</span></div>
    <div class="detail-row"><span class="detail-label">exported</span><span class="detail-val">\${n.isExported ? '✓' : '—'}</span></div>
    \${n.signature ? \`<div class="detail-sig">\${esc(n.signature)}</div>\` : ''}
    <div class="detail-actions">
      <button class="action-btn" onclick="copyToClipboard('\${copyRef.replace(/'/g,'\\\\'+'\\'')}')">⎘ Copy ref</button>
      <button class="action-btn" onclick="setPathFrom('\${nodeId}')">⟶ Path from here</button>
    </div>
  \`;

  // Re-attach history buttons
  document.getElementById('hist-back').addEventListener('click', () => {
    if (histIdx > 0) { histIdx--; updateHistoryNav(); showDetail(navHistory[histIdx], false); network.selectNodes([navHistory[histIdx]]); }
  });
  document.getElementById('hist-forward').addEventListener('click', () => {
    if (histIdx < navHistory.length - 1) { histIdx++; updateHistoryNav(); showDetail(navHistory[histIdx], false); network.selectNodes([navHistory[histIdx]]); }
  });
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── Network click handler ─────────────────────────────────────────────────────
network.on('click', params => {
  if (params.nodes.length === 0) return;
  const nodeId = params.nodes[0];

  if (pathMode) {
    handlePathClick(nodeId);
    return;
  }

  showDetail(nodeId, true);

  // Switch to detail tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="detail"]').classList.add('active');
  document.getElementById('tab-detail').style.display  = '';
  document.getElementById('tab-legend').style.display  = 'none';
  document.getElementById('tab-filters').style.display = 'none';
});

// Double-click to exit focus mode
network.on('doubleClick', params => {
  if (focusActive && params.nodes.length === 0) exitFocus();
});

// ── Focus mode ────────────────────────────────────────────────────────────────
document.getElementById('btn-focus').addEventListener('click', () => {
  if (focusActive) { exitFocus(); return; }
  const selected = network.getSelectedNodes();
  if (selected.length === 0) {
    document.getElementById('btn-focus').classList.add('warn');
    setTimeout(() => document.getElementById('btn-focus').classList.remove('warn'), 800);
    return;
  }
  enterFocus(selected[0]);
});

function enterFocus(nodeId) {
  exitPath(false);
  focusActive = true;
  focusSet = new Set([nodeId, ...(adj[nodeId] ?? [])]);
  document.getElementById('btn-focus').classList.add('active');
  applyFilters();
}

function exitFocus() {
  focusActive = false;
  focusSet    = new Set();
  document.getElementById('btn-focus').classList.remove('active');
  applyFilters();
}

// ── Path mode ─────────────────────────────────────────────────────────────────
document.getElementById('btn-path').addEventListener('click', () => {
  if (pathMode) { exitPath(true); } else { enterPath(); }
});

function enterPath() {
  exitFocus();
  pathMode   = true;
  pathStep   = 1;
  pathFromId = null;
  pathToId   = null;
  clearPathHighlight();
  document.getElementById('btn-path').classList.add('active');
  document.getElementById('path-bar').style.display = 'block';
  document.getElementById('path-bar').textContent   = 'Click a node to set start…';
}

function exitPath(resetHighlight) {
  pathMode = false;
  pathStep = 0;
  document.getElementById('btn-path').classList.remove('active');
  document.getElementById('path-bar').style.display = 'none';
  if (resetHighlight) clearPathHighlight();
}

function setPathFrom(nodeId) {
  enterPath();
  handlePathClick(nodeId);
}

function handlePathClick(nodeId) {
  if (pathStep === 1) {
    pathFromId = nodeId;
    pathStep   = 2;
    document.getElementById('path-bar').textContent = \`From: \${nodeById[nodeId]?.label ?? nodeId} — now click destination…\`;
    network.selectNodes([nodeId]);
  } else if (pathStep === 2) {
    pathToId = nodeId;
    exitPath(false);
    runPathBFS(pathFromId, pathToId);
  }
}

function runPathBFS(fromId, toId) {
  if (fromId === toId) return;
  const prev  = new Map();
  const queue = [fromId];
  const visited = new Set([fromId]);

  outer: while (queue.length > 0) {
    const cur = queue.shift();
    const neighbors = adj[cur] ?? new Set();
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.add(nb);
        prev.set(nb, cur);
        if (nb === toId) break outer;
        queue.push(nb);
      }
    }
  }

  if (!prev.has(toId)) {
    showPathResult([], fromId, toId);
    return;
  }

  const pathIds = [];
  let cur = toId;
  while (cur !== undefined) { pathIds.unshift(cur); cur = prev.get(cur); }

  highlightPath(pathIds);
  showPathResult(pathIds, fromId, toId);
}

function highlightPath(pathIds) {
  clearPathHighlight();
  pathHighlightActive = true;

  const pathSet = new Set(pathIds);
  const DIM  = { background: '#141420', border: '#1a1a2e', highlight: { background: '#1a1a2e', border: '#2a2a3e' } };
  const GOLD = { background: '#f39c12', border: '#e67e22', highlight: { background: '#ffd700', border: '#f39c12' } };

  const nodeUpdates = NODES_DATA.map(n => ({
    id: n.id, color: pathSet.has(n.id) ? GOLD : DIM,
  }));
  nodesDS.update(nodeUpdates);

  // Highlight path edges
  const pathEdgeIds = new Set();
  for (let i = 0; i < pathIds.length - 1; i++) {
    const eid = edgeMap[pathIds[i] + '|' + pathIds[i + 1]];
    if (eid !== undefined) pathEdgeIds.add(eid);
  }

  const edgeUpdates = EDGES_DATA.map(e => ({
    id: e.id,
    color: pathEdgeIds.has(e.id)
      ? { color: '#f39c12', opacity: 1 }
      : { color: '#1a1a2e', opacity: 0.15 },
    width: pathEdgeIds.has(e.id) ? 3 : 1,
  }));
  edgesDS.update(edgeUpdates);

  network.selectNodes(pathIds);
  network.fit({ nodes: pathIds, animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
}

function clearPathHighlight() {
  if (!pathHighlightActive) return;
  pathHighlightActive = false;
  nodesDS.update(NODES_DATA.map(n => ({ id: n.id, color: originalColors[n.id], width: n.borderWidth })));
  edgesDS.update(EDGES_DATA.map(e => ({ id: e.id, color: originalEdgeColors[e.id], width: e.width })));
}

function showPathResult(pathIds, fromId, toId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="detail"]').classList.add('active');
  document.getElementById('tab-detail').style.display  = '';
  document.getElementById('tab-legend').style.display  = 'none';
  document.getElementById('tab-filters').style.display = 'none';

  const from = nodeById[fromId];
  const to   = nodeById[toId];

  if (pathIds.length === 0) {
    document.getElementById('tab-detail').innerHTML = \`
      <div id="history-nav">
        <button class="hist-btn" id="hist-back" disabled>‹</button>
        <span id="hist-label">path result</span>
        <button class="hist-btn" id="hist-forward" disabled>›</button>
      </div>
      <p style="color:#e67e22;font-size:12px;margin-top:8px">No path found between <b>\${esc(from?.label)}</b> and <b>\${esc(to?.label)}</b>.</p>
      <button class="action-btn" style="margin-top:10px" onclick="resetToEmpty()">✕ Clear</button>
    \`;
    return;
  }

  const steps = pathIds.map((id, i) => {
    const n = nodeById[id];
    return \`
      \${i > 0 ? '<div class="path-connector">│</div>' : ''}
      <div class="path-step">
        <span class="path-step-num">\${i + 1}.</span>
        <span>
          <span class="path-step-name" onclick="showDetail('\${id}',true);network.selectNodes(['\${id}'])">\${esc(n?.label ?? id)}</span>
          <span class="path-step-kind"> \${esc(n?.kind ?? '')}</span>
        </span>
      </div>
    \`;
  }).join('');

  document.getElementById('tab-detail').innerHTML = \`
    <div id="history-nav">
      <button class="hist-btn" id="hist-back" disabled>‹</button>
      <span id="hist-label">path: \${pathIds.length} hops</span>
      <button class="hist-btn" id="hist-forward" disabled>›</button>
    </div>
    <div style="font-size:11px;color:#546e7a;margin-bottom:10px">
      \${esc(from?.label)} → \${esc(to?.label)}
    </div>
    <div class="path-result">\${steps}</div>
    <button class="action-btn" style="margin-top:12px" onclick="resetToEmpty()">✕ Clear</button>
  \`;
}

// ── Node kind filter ──────────────────────────────────────────────────────────
document.querySelectorAll('.legend-item[data-nkind]').forEach(item => {
  item.addEventListener('click', () => {
    const kind = item.dataset.nkind;
    hiddenNodeKinds.has(kind) ? hiddenNodeKinds.delete(kind) : hiddenNodeKinds.add(kind);
    item.classList.toggle('dimmed', hiddenNodeKinds.has(kind));
    applyFilters();
  });
});

// ── Edge kind filter ──────────────────────────────────────────────────────────
document.querySelectorAll('.legend-item[data-ekind]').forEach(item => {
  item.addEventListener('click', () => {
    const kind = item.dataset.ekind;
    hiddenEdgeKinds.has(kind) ? hiddenEdgeKinds.delete(kind) : hiddenEdgeKinds.add(kind);
    item.classList.toggle('dimmed', hiddenEdgeKinds.has(kind));
    applyFilters();
  });
});

// ── Degree slider ─────────────────────────────────────────────────────────────
document.getElementById('degree-slider').addEventListener('input', e => {
  minDegree = parseInt(e.target.value, 10);
  document.getElementById('degree-val').textContent = String(minDegree);
  applyFilters();
});

// ── Search ────────────────────────────────────────────────────────────────────
let searchTimer = null;
document.getElementById('search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim().toLowerCase();
  searchTimer = setTimeout(() => {
    withLoader(false, () => {
      if (!q) {
        searchActive = false;
        searchIds    = new Set();
      } else {
        const matches = NODES_DATA.filter(n =>
          n.label.toLowerCase().includes(q) ||
          n.qualifiedName.toLowerCase().includes(q) ||
          n.filePath.toLowerCase().includes(q)
        );
        searchActive = true;
        searchIds    = new Set(matches.map(n => n.id));
      }
      applyFilters(true);
      if (searchActive && searchIds.size > 0) {
        network.fit({ nodes: [...searchIds], animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
      } else if (!searchActive) {
        network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
      }
    });
  }, 180);
});

// ── Toolbar buttons ───────────────────────────────────────────────────────────
document.getElementById('btn-fit').addEventListener('click', () =>
  network.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })
);

let physicsOn = true;
document.getElementById('btn-physics').addEventListener('click', () => {
  physicsOn = !physicsOn;
  network.setOptions({ physics: { enabled: physicsOn } });
  document.getElementById('btn-physics').classList.toggle('active', physicsOn);
});

document.getElementById('btn-fullscreen').addEventListener('click', () => {
  document.body.classList.toggle('fullscreen');
  const fs = document.body.classList.contains('fullscreen');
  document.getElementById('btn-fullscreen').classList.toggle('active', fs);
  setTimeout(() => network.fit({ animation: false }), 220);
});

document.getElementById('btn-png').addEventListener('click', () => {
  const canvas = document.querySelector('#graph canvas');
  if (!canvas) return;
  const tmp = document.createElement('canvas');
  tmp.width  = canvas.width;
  tmp.height = canvas.height;
  const ctx  = tmp.getContext('2d');
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(canvas, 0, 0);
  const a    = document.createElement('a');
  a.href     = tmp.toDataURL('image/png');
  a.download = 'kirograph-' + Date.now() + '.png';
  a.click();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (pathMode)    { exitPath(true); }
    if (focusActive) { exitFocus(); }
  }
  if (e.key === 'f' && !e.metaKey && !e.ctrlKey && e.target.tagName !== 'INPUT') {
    network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
  }
});

// ── Reset to empty state ──────────────────────────────────────────────────────
function resetToEmpty() {
  clearPathHighlight();
  network.unselectAll();
  applyFilters(true);
  document.getElementById('tab-detail').innerHTML = '<p class="detail-empty">Click a node to inspect it.</p>';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body>
</html>`;
}

export function register(program: Command): void {
  const exportCmd = program
    .command('export')
    .description('Export the graph as an interactive HTML visualization');

  exportCmd
    .command('build [projectPath]')
    .description('Generate the HTML file (default: .kirograph/kirograph.html)')
    .option('-o, --output <file>', 'Output file path')
    .option('--include-contains', 'Include structural contains edges (adds noise, off by default)', false)
    .action(async (projectPath, opts) => {
      await generateExport(projectPath, opts);
    });

  exportCmd
    .command('start [projectPath]')
    .description('Generate the HTML file and open it in the browser')
    .option('-o, --output <file>', 'Output file path')
    .option('--include-contains', 'Include structural contains edges (adds noise, off by default)', false)
    .action(async (projectPath, opts) => {
      const outPath = await generateExport(projectPath, opts);
      console.log(`  ${dim}Opening in browser…${reset}\n`);
      openBrowser(outPath);
    });
}
