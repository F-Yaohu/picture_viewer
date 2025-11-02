# 阶段 1: 构建前端和安装所有依赖
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 阶段 2: 创建最终的、精简的生产镜像
FROM node:20-alpine
WORKDIR /app

# 从构建器阶段仅拷贝必要的生产依赖
COPY --from=builder /app/node_modules ./node_modules
# 从构建器阶段拷贝构建好的前端静态资源
COPY --from=builder /app/dist ./dist
# 拷贝生产环境需要的服务端脚本和包文件
COPY server.cjs ./
COPY package*.json ./
# 拷贝自定义的 nginx 配置文件
COPY /nginx ./nginx

# 清理掉开发依赖，进一步减小镜像体积
RUN npm prune --production

# 暴露服务运行的端口
EXPOSE 3889

# 启动应用的命令
CMD ["node", "server.cjs"]
