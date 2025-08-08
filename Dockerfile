# 1. 使用官方 Node.js 运行时作为基础镜像
FROM node:20-alpine

# 2. 设置工作目录
WORKDIR /app

# 3. 复制 package.json 和 package-lock.json
COPY package.json ./
# 如果有 package-lock.json 也一并复制
COPY package-lock.json ./

# 4. 安装依赖
RUN npm install

# 5. 复制项目所有文件（包括 src、server.js 等）
COPY . .

# 6. 构建前端
RUN npm run build

# 7. 暴露端口
EXPOSE 3889

# 8. 启动 Node.js 服务
CMD ["npm", "start"]