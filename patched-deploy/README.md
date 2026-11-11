# PandaWiki 定制部署

基于 [chaitin/PandaWiki](https://github.com/chaitin/PandaWiki) 的本地定制构建，包含两部分改动：

1. **后端**：解锁发行版二进制里的版本限制（`edition` 恒按企业版处理）
2. **前端**：精简管理后台侧边栏，底部只保留版本号

## 目录

| 文件 | 说明 |
|---|---|
| `patch_license.py` | 对官方 `panda-wiki-api` 二进制打补丁的脚本（自动定位，不写死偏移） |
| `docker-compose.patched.yml` | 部署编排，把补丁后的二进制与自编译前端挂载进容器 |
| `.env.example` | 环境变量模板，复制为 `.env` 后填写 |

## 一、后端补丁

### 限制在哪里

官方开源仓库 `backend/` 只含社区版骨架；专业/企业能力位于**私有子模块**
`backend/pro`（`git@github.com:chaitin/PandaWikiPro.git`，公开访问 404）。
因此版本限制逻辑只存在于发行版二进制中，改源码无法触及。

从二进制恢复出的符号可知链路为：

```
LicenseService ──gRPC──> pandawiki.license.baizhi.cloud  校验机器码
  → LicenseData.edition (0社区/1专业/2企业/3商业)
  → LicenseMiddleware: c.Set("edition", …) + c.Set("edition_limitation", …)
  → 各 handler 的 ValidateLimitation / GetBaseEditionLimitation(ctx) 做配额与功能判定
  → GetLicense 把 edition 回给前端
```

二进制内**没有本地签名自校验**，授权结果完全来自远端 gRPC，因此不存在
「伪造 license 文件离线激活」的路径；把 `edition` 固定为 2（企业版）即可让
配额变为无限、功能开关全开。

### 打补丁

补丁脚本不写死文件偏移：解析 Go `pclntab` 拿到函数入口，再按指令模式
（`ldr wN,[xM,#0x30]` = 读取 `LicenseData.edition`）定位打点。

```bash
docker create --name pw chaitin-registry.cn-hangzhou.cr.aliyuncs.com/chaitin/panda-wiki-api:v3.87.5
docker cp pw:/app/panda-wiki-api ./panda-wiki-api
docker rm pw

python3 patch_license.py ./panda-wiki-api ./panda-wiki-api.patched
```

打点位置（arm64）：

| 函数 | 改动 |
|---|---|
| `pro/middleware.(*LicenseMiddleware).Middleware` | `edition` / `edition_limitation` 按企业版派生（2 处） |
| 同上 `-fm` method-value 包装版 | 同上（2 处） |
| `pro/domain.GetEditionLimitation` | 入口强制 `w0=2` 并跳入企业版分支 |
| `pro/handler/v1.(*LicenseV1Handler).GetLicense` | 响应 `edition` 字段 = 2 |

企业版限制表从 `rodata` 读出为 `MaxKb = MaxNode = MaxAdmin = MaxInt64`，
11 个 `allow_*` 开关全为 `true`。

## 二、前端精简

改动文件 `web/admin/src/components/Sidebar/`：

- `index.tsx`：删除「帮助文档」「GitHub」「在线支持」三个按钮，及「在线支持」弹窗
- `Version.tsx`：只渲染版本号，去掉型号行、更新提示与点击弹窗
- 删除 `AuthTypeModal.tsx`（授权切换/解绑/商务咨询弹窗）

```bash
cd web
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter panda-wiki-admin build
```

构建产物 `web/admin/dist` 由 compose 挂到 nginx 的 `/opt/frontend/dist`。

## 三、部署

```bash
cp .env.example .env        # 填写密码等
docker compose -f docker-compose.patched.yml up -d
```

首次启动注意：

- 管理后台走 HTTPS，访问 `https://<host>:<ADMIN_PORT>`
- Caddy 的 admin socket 必须放在 Docker 命名卷内，bind mount 会报
  `operation not supported`
- NATS 需开启 JetStream（`-js`），否则 raglite 启动时报
  `no responders available for request`
- 创建知识库前需先配置 embedding 模型，否则 raglite 报
  `no default embedding model available`

## 说明

本项目为个人自用部署版本，跟随上游版本升级时打点偏移可能变化，脚本会明确报出
未定位的函数名供修正。上游采用 AGPL-3.0。
