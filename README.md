# Picture Viewer App

一个基于 **React + TypeScript + Vite** 的本地/远程图片管理与浏览器，支持本地文件夹授权、远程 API 图床、图片元数据管理、Masonry 瀑布流展示、权限管理、多语言（中英文）、Docker 部署等功能。

## 特性

- 📁 支持添加本地文件夹（基于 File System Access API，需现代浏览器）
- 🌐 支持自定义远程 API 图床，字段映射灵活
- 🔍 图片搜索与多数据源筛选
- 🖼 Masonry 瀑布流图片展示，支持懒加载
- 🏷 图片元数据（尺寸、修改时间、来源等）自动提取
- 🗂 数据源管理（启用/禁用、同步、编辑、删除）
- 🔒 权限管理与重新授权提示
- 🌙 暗色主题，基于 MUI
- 🌏 多语言支持（中英文自动切换）
- 🐳 一键 Docker 部署
- ⚡️ Vite 极速开发体验

## 技术栈

- React 19 + TypeScript
- Vite 7
- MUI (Material UI)
- Redux Toolkit
- Dexie（IndexedDB 封装）
- i18next（国际化）
- Docker & docker-compose

## 快速开始

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd picture_viewer
```

### 2. 安装依赖

```bash
npm install
```

### 3. 本地开发

```bash
npm run dev
```

访问 [http://localhost:5173](http://localhost:5173)

### 4. 构建生产包

```bash
npm run build
```

### 5. 启动后端服务（本地/生产）

```bash
npm start
```

默认监听 [http://localhost:3889](http://localhost:3889)

### 6. Docker 部署

构建并启动容器：

```bash
docker-compose up --build -d
```

或手动：

```bash
docker build -t picture-viewer-app .
docker run -d -p 3889:3889 picture-viewer-app
```

## 目录结构

```
picture_viewer/
├── src/                # 前端源码
│   ├── components/     # 主要 UI 组件
│   ├── db/             # Dexie 数据库定义
│   ├── locales/        # 国际化资源
│   ├── store/          # Redux store 及 slices
│   ├── utils/          # 工具函数
│   ├── workers/        # Web Worker（如本地/远程图片扫描）
│   ├── App.tsx         # 应用主入口
│   └── ...
├── public/             # 静态资源
├── api/                # 预留后端接口目录
├── server.cjs          # Node.js Express 服务端（含 API 代理）
├── Dockerfile
├── docker-compose.yml
├── package.json
├── vite.config.ts
└── ...
```

## 主要功能说明

- **本地图片管理**：通过浏览器授权访问本地文件夹，支持子文件夹递归扫描，图片元数据自动提取。
- **远程图床支持**：可配置 API 地址、请求方法、参数、响应字段映射，支持分页与自定义头部。
- **权限管理**：如本地文件夹权限失效，自动提示用户重新授权。
- **图片浏览**：支持全屏查看、缩放、拖拽、键盘切换、图片元数据展示。
- **数据源管理**：支持添加、编辑、同步、删除本地/远程数据源。
- **多语言**：自动检测浏览器语言，支持中英文切换。

## 注意事项

- 本地文件夹功能依赖于 [File System Access API](https://developer.mozilla.org/zh-CN/docs/Web/API/File_System_Access_API)，仅支持 Chromium 内核浏览器（如 Chrome、Edge）。
- 远程 API 需支持跨域或通过内置 `/api/proxy` 代理转发。
- Docker 镜像默认暴露 3889 端口。

## 许可证

MIT

---

如需二次开发或遇到问题，欢迎提 Issue 或 PR！