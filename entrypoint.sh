#!/bin/sh
# 把nginx配置文件和dist文件覆盖到本地文件夹
mv /app/nginx_temp/* /app/nginx
mv /app/dist_temp/* /app/dist
# 启动服务...
exec node server.cjs