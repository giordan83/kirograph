import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { spawnSync, spawn } from 'child_process';
import { dim, reset, violet, bold, green } from '../ui';
import { DASHBOARD_SUBDIR } from '../../vectors/qdrant-index';

const SERVER_STATE_FILE = 'qdrant-server.json';
interface ServerState { pid: number; port: number; }

const UI_RELEASES_API = 'https://api.github.com/repos/qdrant/qdrant-web-ui/releases/latest';

// ── Download ───────────────────────────────────────────────────────────────────

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'kirograph' } }, res => {
      let body = '';
      res.on('data', (c: string) => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    function doGet(currentUrl: string) {
      const mod = currentUrl.startsWith('https') ? https : http;
      mod.get(currentUrl, { headers: { 'User-Agent': 'kirograph' } } as any, res => {
        if (res.statusCode === 301 || res.statusCode === 302) return doGet(res.headers.location!);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      }).on('error', reject);
    }
    doGet(url);
  });
}

async function downloadQdrantUI(cacheDir: string): Promise<void> {
  // Fetch latest release to get zip URL
  const release  = await fetchJson(UI_RELEASES_API);
  const asset    = (release.assets as any[]).find((a: any) => a.name === 'dist-qdrant.zip');
  if (!asset) throw new Error('dist-qdrant.zip not found in latest release');

  const tmpZip = path.join(cacheDir, '..', '_qdrant-ui.zip');
  fs.mkdirSync(path.dirname(tmpZip), { recursive: true });

  await downloadFile(asset.browser_download_url, tmpZip);

  // Extract zip — `unzip` is available on macOS and most Linux distros
  // Extract to a temp dir then move the dist/ subfolder to cacheDir
  const tmpDir = path.join(cacheDir, '..', '_qdrant-ui-extract');
  fs.mkdirSync(tmpDir, { recursive: true });

  const result = spawnSync('unzip', ['-o', tmpZip, '-d', tmpDir], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error('unzip failed — is unzip installed?');

  // Move dist/ contents to cacheDir
  const distDir = path.join(tmpDir, 'dist');
  if (!fs.existsSync(distDir)) throw new Error('dist/ not found in zip');

  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.renameSync(distDir, cacheDir);

  // Cleanup
  try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Browser open ───────────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start'
            : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch { /* best-effort */ }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Download the Qdrant Web UI if not already cached. Returns true on success. */
export async function ensureQdrantUI(projectRoot: string): Promise<boolean> {
  const cacheDir = path.join(projectRoot, '.kirograph', DASHBOARD_SUBDIR);
  const indexHtml = path.join(cacheDir, 'index.html');
  if (fs.existsSync(indexHtml)) return true;

  process.stdout.write(`  Downloading Qdrant Web UI (first time only)…\n`);
  try {
    await downloadQdrantUI(cacheDir);
    process.stdout.write(`  Qdrant Web UI ready.\n`);
    return true;
  } catch (err) {
    process.stdout.write(`  Qdrant Web UI download failed: ${String(err)}\n`);
    return false;
  }
}

export async function openQdrantDashboard(projectRoot: string): Promise<void> {
  const kirographDir = path.join(projectRoot, '.kirograph');

  // Read Qdrant server port
  let port: number | null = null;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(kirographDir, SERVER_STATE_FILE), 'utf8')) as ServerState;
    port = state.port;
  } catch { /* not running */ }

  if (!port) {
    process.stdout.write(`  Qdrant server is not running — use kg qdrant start.\n`);
    return;
  }

  const url = `http://127.0.0.1:${port}/dashboard`;

  console.log(`\n  ${violet}${bold}Qdrant Dashboard${reset}  ${dim}(built-in)${reset}`);
  console.log(`  ${green}✓${reset} Opening ${violet}${url}${reset}`);
  console.log();

  openBrowser(url);
}
