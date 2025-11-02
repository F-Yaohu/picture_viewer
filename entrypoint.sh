#!/bin/sh
set -e  # 遇到错误立即退出

# 定义路径（清晰变量更易维护）
VOLUME_NGINX="/app/nginx"       # 对应 Named Volume 映射的目录
VOLUME_DIST="/app/dist"
TEMP_NGINX="/app/nginx_temp"    # 存放新内容的临时目录
TEMP_DIST="/app/dist_temp"

# --------------------------
# 1. 校验临时目录有效性（避免空或无效内容）
# --------------------------
if [ ! -d "$TEMP_NGINX" ] || [ ! -d "$TEMP_DIST" ]; then
  echo "错误：缺少临时内容目录 $TEMP_NGINX 或 $TEMP_DIST"
  exit 1
fi

# --------------------------
# 2. 用新内容覆盖 Volume 目录（而非删除！）
# --------------------------
echo "正在更新 Nginx 配置..."
cp -rf "${TEMP_NGINX}/"* "${VOLUME_NGINX}/"  # -r 递归复制，-f 强制覆盖

echo "正在更新前端静态文件..."
cp -rf "${TEMP_DIST}/"* "${VOLUME_DIST}/"

# --------------------------
# 3. （可选）修复权限（若 Volume 权限丢失）
# --------------------------
# chown -R nginx:nginx "${VOLUME_NGINX}" "${VOLUME_DIST}"  # 替换为实际运行用户/组
# chmod -R 755 "${VOLUME_NGINX}" "${VOLUME_DIST}"

# --------------------------
# 4. 启动服务（确保 Volume 已更新）
# --------------------------
echo "启动服务..."
exec node server.cjs