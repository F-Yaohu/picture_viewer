## 快速目标（给 AI 开发代理）

这是一个基于 React + TypeScript + Vite 的前端应用（包含一个小型 Node 静态/代理服务）。目标是让你迅速理解项目结构、常见改动点及工程命令，以便能安全、可预测地修改代码或实现新特性。

### 核心概要
- 前端：`src/`（入口 `src/main.tsx`, 主组件 `src/App.tsx`）。UI 基于 MUI（`@mui/material`）。
- 状态：Redux Toolkit（`src/store/store.ts` 与 `src/store/slices/*.ts`，例如 `dataSourceSlice.ts`）。
- 本地数据：Dexie（IndexedDB 封装），定义在 `src/db/db.ts`。
- 后台/代理：简单 Node 服务在 `server.cjs`（用于静态与 `/api/proxy` 转发）。
- Worker：长耗时扫描/索引任务放在 `src/workers/scan.worker.ts`。

### 重要文件（快速索引）
- `package.json` — 启动/构建脚本（`dev`, `build`, `start`, `preview`, `lint`）。
- `vite.config.ts` — Vite 配置（开发/构建时重要）。
- `src/components/` — 关键 UI 组件（如 `ImageGrid.tsx`, `FullscreenViewer.tsx`, `DataSourceList.tsx`, `RemoteSourceDialog.tsx`）。
- `src/utils/permissionUtils.ts` — 本地文件夹授权逻辑（File System Access API），常见错误/重新授权提示逻辑在此处。
- `src/utils/imageUrlCache.ts` — 图片 URL 缓存/预处理工具。
- `src/i18n.ts` 与 `src/locales/` — 国际化（中/英）。

### 常见工程命令（示例）
- 本地开发（推荐两终端）：
  1) 在一个终端启动后端/代理：`node server.cjs`
  2) 在另一个终端启动前端开发：`npm run dev`
- 构建与本地运行生产包：`npm run build` 然后 `npm start`（`build` 会先 `tsc -b` 然后 `vite build`）。
- Lint：`npm run lint`。

### 项目约定与模式（可直接遵循）
- Redux：使用 Redux Toolkit 的 slice 模式。要新增状态或业务流，优先在 `src/store/slices/` 新建或修改 slice，并在 `src/store/store.ts` 注册。
- 持久化：使用 Dexie（`src/db/db.ts`）管理 IndexedDB，数据模型变更需同步更新该文件并考虑迁移策略。
- 长耗时任务：将扫描/索引等逻辑放入 `src/workers/scan.worker.ts`，主线程通过 postMessage 与 worker 交互。
- 权限：对本地文件夹访问，优先复用 `permissionUtils.ts` 中的工具；UI 中 `PermissionManager.tsx` 负责提示与重试流程。
- 远程数据源：`RemoteSourceDialog.tsx` 处理 API 配置和字段映射，注意请求/响应的分页与 CORS（也可走内置 `/api/proxy`）。

### 部署与 Docker 相关要点
- 镜像/容器：README 中给出 `docker-compose.yml` 示例。容器通过环境变量 `SERVER_SOURCES` 传入服务器端的数据源映射，路径需与容器内 `volumes` 映射一致。
- 服务器端依赖 `sharp`（用于图像处理），任何对图像的后端处理改动通常需要在 `server.cjs` 或新增的后端模块中修改并重建镜像。

### 修改/新增功能的小贴士（示例）
- 新增数据源类型：
  1) 在 `src/store/slices/dataSourceSlice.ts` 添加对应 action/reducer 设置默认状态。
  2) 在 UI 添加表单（如 `RemoteSourceDialog.tsx`）并复用现有映射字段结构。
  3) 若需存储到浏览器端，更新 `src/db/db.ts` 并处理 Dexie 模式。

- 添加后端代理端点：修改 `server.cjs`，并在前端使用 `/api/proxy` 路由（如需跨域或转发头部）。

### 不要做的事（安全边界）
- 不要在前端直接硬编码敏感凭证或外部服务密钥。若必须，请通过 `server.cjs` 代理或环境变量注入到服务端。
- 不要绕过 `permissionUtils.ts` 的授权流程：File System Access API 权限必须通过用户触发的 UI 流程获得。

### 快速示例片段（修改 Redux slice 的路径）
示例：若要更新数据源状态，编辑 `src/store/slices/dataSourceSlice.ts` 并在 `src/store/store.ts` 注册；UI 组件 `DataSourceList.tsx` 会自动读取该 slice。

---
如果你希望我合并进现有的 `.github/copilot-instructions.md`（若仓库后来添加了一个），或把内容扩展为更详细的开发者指南（包含示例 PR/issue 模板、代码风格规则、常见改动 checklist），请告诉我你想要的深度和重点区域。现在我会把这个文件添加到仓库并继续下一个验证步骤。
