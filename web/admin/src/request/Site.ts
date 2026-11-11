// 控制台扩展接口：站点品牌 + 版本升级
// 走后端 sidecar（/api/v1/site/*），鉴权复用主站 JWT。
import { message } from '@ctzhian/ui';

const BASE = (import.meta.env.VITE_APP_BASE || '') as string;

export interface SiteBrand {
  site_name: string;
  site_icon: string;
}

export interface VersionInfo {
  repo: string;
  current: string;
  latest: string | null;
  has_update: boolean;
  release_url: string;
  release_notes: string;
  published_at: string;
  checked_at: string;
}

interface PWResponse<T> {
  success: boolean;
  code: number;
  message: string;
  data?: T;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('panda_wiki_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  silent = false,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers || {}),
    },
  });
  const body = (await res.json()) as PWResponse<T>;
  if (!body.success) {
    if (!silent) message.error(body.message || '请求失败');
    throw new Error(body.message || 'request failed');
  }
  return body.data as T;
}

/** 读取站点品牌（登录页也调用，无需管理员） */
export const getSiteBrand = () =>
  request<SiteBrand>('/api/v1/site/brand', { method: 'GET' }, true);

/** 更新站点品牌（仅管理员） */
export const updateSiteBrand = (patch: Partial<SiteBrand>) =>
  request<SiteBrand>('/api/v1/site/brand', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

/** 检查 GitHub 最新版本 */
export const getSiteVersion = () =>
  request<VersionInfo>('/api/v1/site/version', { method: 'GET' });

/** 上传站点图标，复用主站文件上传接口，返回可直接使用的 URL */
export async function uploadSiteIcon(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/api/v1/file/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const body = (await res.json()) as PWResponse<{ key: string }>;
  if (!body.success || !body.data?.key) {
    message.error(body.message || '上传失败');
    throw new Error(body.message || 'upload failed');
  }
  return `/static-file/${body.data.key}`;
}
