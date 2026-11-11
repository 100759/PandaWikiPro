# 控制台扩展服务（sidecar）

PandaWiki 官方后端的 `system_settings` 表存在，但开源版没有暴露读写接口，
且专业/企业能力在私有子模块 `backend/pro` 中，无法从源码重新编译。
因此用这个独立的 Node 服务补齐两个能力，由 nginx 把 `/api/v1/site/*` 转发过来：

| 接口 | 方法 | 权限 | 说明 |
|---|---|---|---|
| `/api/v1/site/brand` | GET | 公开 | 登录页需要，无需鉴权 |
| `/api/v1/site/brand` | PUT | 管理员 | 保存站点名称与头像 |
| `/api/v1/site/version` | GET | 管理员 | 对比 GitHub tag，返回是否有新版本 |
| `/healthz` | GET | 公开 | 健康检查 |

## 鉴权

复用主站的 JWT：用同一个 `JWT_SECRET` 校验 HS256 签名，再查 `users.role` 判断管理员，
与主站 `ValidateUserRole(consts.UserRoleAdmin)` 保持一致。

## 版本检查

优先走 GitHub REST API；触发速率限制时自动回退到 `git ls-remote --tags`，
两者都不受限于固定 IP 的 60 次/小时。缓存 60 秒。

配置 `GITHUB_TOKEN` 可提高 REST 限额；不配也能工作。

## 数据

品牌配置存在主库已有的 `system_settings` 表，键名 `brand`：

```json
{ "site_name": "FuHeng Wiki", "site_icon": "/static-file/<key>" }
```

头像走后端现有的 `/api/v1/file/upload` 上传到 MinIO，存的是相对路径。
