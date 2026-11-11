// PandaWiki 控制台扩展服务
// 1) 站点品牌：读写 system_settings.brand（名称 + 头像）
// 2) 版本升级：从 GitHub 比对 tag，按需拉取并重建
// 鉴权：复用主 API 的 JWT（同一 JWT_SECRET），仅 admin 角色可用。

import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.PORT || 8099);
const JWT_SECRET = process.env.JWT_SECRET || '';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://panda-wiki:change-me@panda-wiki-postgres:5432/panda-wiki';
const GITHUB_REPO = process.env.GITHUB_REPO || 'chaitin/PandaWiki';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const SELF_VERSION = process.env.SELF_VERSION || 'dev';

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

/* ---------------- JWT ---------------- */

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(data) {
  return createHmac('sha256', JWT_SECRET).update(data).digest();
}

// 校验 HS256 JWT，返回 payload 或 null
function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header;
  try {
    header = JSON.parse(b64urlDecode(h).toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const expected = sign(`${h}.${p}`);
  const actual = b64urlDecode(s);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(p).toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

/* ---------------- 响应 ---------------- */

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

const ok = (res, data) => send(res, 200, { success: true, code: 0, message: '', data });
const fail = (res, code, message) => send(res, 200, { success: false, code: code || 0, message });

function readBody(req, limit = 8 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------------- 鉴权 ---------------- */

async function requireAdmin(req, res) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    fail(res, 401, 'Unauthorized');
    return null;
  }
  const payload = verifyJwt(auth.slice(7));
  if (!payload || !payload.id) {
    fail(res, 401, 'Unauthorized');
    return null;
  }
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [payload.id]);
  if (!rows.length || rows[0].role !== 'admin') {
    fail(res, 403, '需要管理员权限');
    return null;
  }
  return payload;
}

/* ---------------- 品牌配置 ---------------- */

const BRAND_KEY = 'brand';
const DEFAULT_BRAND = { site_name: 'PandaWiki', site_icon: '' };

async function getBrand() {
  const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [BRAND_KEY]);
  if (!rows.length) return { ...DEFAULT_BRAND };
  return { ...DEFAULT_BRAND, ...rows[0].value };
}

async function saveBrand(patch) {
  const cur = await getBrand();
  const next = { ...cur, ...patch };
  await pool.query(
    `INSERT INTO system_settings (key, value, description)
     VALUES ($1, $2::jsonb, '控制台品牌配置')
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [BRAND_KEY, JSON.stringify(next)],
  );
  return next;
}

/* ---------------- GitHub 版本 ---------------- */

let versionCache = { at: 0, data: null };
const CACHE_MS = 60_000;

async function ghFetch(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'panda-wiki-sidecar',
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${r.statusText}`);
  return r.json();
}

// 语义化版本比较：v3.87.10 > v3.87.9
function cmpVersion(a, b) {
  const norm = v => String(v).replace(/^v/i, '').split(/[.\-+]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
  const A = norm(a);
  const B = norm(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0;
    const y = B[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) > String(y) ? 1 : -1;
  }
  return 0;
}

// 回退方案：直接问 git 有哪些 tag，不受 REST API 速率限制
async function tagsViaGit() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const url = `https://github.com/${GITHUB_REPO}.git`;
  const { stdout } = await run('git', ['ls-remote', '--tags', '--refs', url], {
    timeout: 20_000,
    maxBuffer: 4 << 20,
  });
  return stdout
    .split('\n')
    .map(l => l.split('refs/tags/')[1])
    .filter(Boolean);
}

async function getLatest() {
  if (Date.now() - versionCache.at < CACHE_MS && versionCache.data) return versionCache.data;

  const [tags, releases] = await Promise.all([
    ghFetch(`/repos/${GITHUB_REPO}/tags?per_page=100`).catch(async e => {
      console.warn('[sidecar] REST tags 失败，改用 git ls-remote:', e.message);
      try {
        return (await tagsViaGit()).map(name => ({ name }));
      } catch (e2) {
        console.warn('[sidecar] ls-remote 也失败:', e2.message);
        return [];
      }
    }),
    ghFetch(`/repos/${GITHUB_REPO}/releases/latest`).catch(() => null),
  ]);

  const names = new Set();
  for (const t of tags) if (t?.name) names.add(t.name);
  if (releases?.tag_name) names.add(releases.tag_name);

  const list = [...names].filter(n => /^v?\d/.test(n)).sort(cmpVersion);
  const latest = list.length ? list[list.length - 1] : null;

  const data = {
    repo: GITHUB_REPO,
    current: SELF_VERSION,
    latest,
    has_update: latest ? cmpVersion(latest, SELF_VERSION) > 0 : false,
    release_url: latest ? `https://github.com/${GITHUB_REPO}/releases/tag/${latest}` : '',
    release_notes: releases?.body || '',
    published_at: releases?.published_at || '',
    checked_at: new Date().toISOString(),
  };
  versionCache = { at: Date.now(), data };
  return data;
}

/* ---------------- 路由 ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  try {
    // 健康检查
    if (path === '/healthz') return ok(res, { status: 'ok' });

    // 品牌读取：登录页需要，不限管理员
    if (path === '/api/v1/site/brand' && method === 'GET') {
      return ok(res, await getBrand());
    }

    // 以下均需管理员
    if (path === '/api/v1/site/brand' && method === 'PUT') {
      const claims = await requireAdmin(req, res);
      if (!claims) return;
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const patch = {};
      if (typeof body.site_name === 'string') patch.site_name = body.site_name.trim().slice(0, 64);
      if (typeof body.site_icon === 'string') patch.site_icon = body.site_icon;
      return ok(res, await saveBrand(patch));
    }

    if (path === '/api/v1/site/version' && method === 'GET') {
      const claims = await requireAdmin(req, res);
      if (!claims) return;
      return ok(res, await getLatest());
    }

    return fail(res, 404, 'Not Found');
  } catch (err) {
    console.error('[sidecar]', req.method, req.url, err?.message || err);
    return fail(res, 500, err?.message || 'internal error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[sidecar] listening on :${PORT}, repo=${GITHUB_REPO}, self=${SELF_VERSION}`);
});
