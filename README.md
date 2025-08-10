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

## Docker 部署

本项目支持通过 Docker 和 Docker Compose 进行快速部署。

### 1. 先决条件

-   已安装 [Docker](https://www.docker.com/get-started)
-   已安装 [Docker Compose](https://docs.docker.com/compose/install/)

### 2. 配置

在部署之前，您如果需要配置要展示的服务端图片文件夹，请参考以下操作。

1.  **打开 `docker-compose.yml` 文件。**

2.  **映射文件夹 (`volumes`):**
    找到 `volumes` 部分。您需要将您宿主机（您的电脑）上的图片文件夹路径映射到容器内部。请修改以下示例行：

    ```yaml
    volumes:
      # 将左侧的路径替换为您自己的图片文件夹路径
      # 将右侧的路径作为容器内的别名（建议保持 /data/... 的格式）
      - /xxx/你需要展示的文件夹1:/data/landscapes
      - /xxx/你需要展示的文件夹2:/data/anime
    ```
    您可以根据需要添加任意多行来进行文件夹映射。

3.  **配置环境变量 (`environment`):**
    找到 `environment` 部分。您需要在这里定义 `SERVER_SOURCES` 变量，让应用知道每个文件夹在前端应该显示什么名字。

    ```yaml
    environment:
      # "name" 是您希望在网页上看到的分类名
      # "path" 必须与您在 volumes 中设置的容器内路径完全一致
      - SERVER_SOURCES=[{"name":"风景壁纸","path":"/data/landscapes"},{"name":"动漫收藏","path":"/data/anime"}]
    ```
    请确保 `volumes` 和 `environment` 中的路径配置是匹配的。

### 3. 启动服务

完成配置后，在项目根目录下打开终端，运行以下命令：

```bash
docker-compose up -d
```

该命令会自动拉取或构建 Docker 镜像，并以后台模式启动服务。

### 4. 访问应用

现在，您可以在浏览器中打开 `http://localhost:3889` 来访问您的图片查看器应用。您应该能看到您配置的服务端图片。

### 5. 停止服务

要停止服务，请在项目根目录下运行：

```bash
docker-compose down
```

## 本地开发

如需本地开发或自定义构建：

```bash
# 1. 安装依赖
npm install

# 2. 在一个终端启动后端服务
node server.cjs

# 3. 在另一个终端启动前端开发服务器
npm run dev
```

访问 [http://localhost:5173](http://localhost:5173)

## 构建生产包并本地运行

```bash
npm run build
npm start
```

默认监听 [http://localhost:3889](http://localhost:3889)


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