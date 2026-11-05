# WeedingServer

Weeding 游戏独立房间服务器。协议 **10**，HTTP/JSON + WebSocket 使用同一 TCP 端口，每间最多 4 人。无需 Unity Dedicated Server 构建或数据库。

## 本地启动

Node.js 22 或更新版本，npm。

```bash
npm ci
cp .env.example .env
npm start
curl --fail http://127.0.0.1:8788/health
npm test
```

入口：server.cjs。npm start 自动加载可选 .env；直接 node server.cjs 不读取 .env，需通过 shell 或 systemd 注入配置。

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| WEEDING_PORT | 8788 | 监听 0.0.0.0 的 TCP 端口 |
| WEEDING_DISABLE_WS | 未设置 | 1 关闭 WebSocket，保留 HTTP |

## 上传 Ubuntu

私有仓库需要有读取权限的账号或只读 deploy key。不要在 URL 中写令牌，不要上传 SSH 私钥。

```bash
git clone git@github.com:kfsz-x/WeedingServer.git
cd WeedingServer
npm ci --omit=dev
```

也可用 SFTP 上传代码到 /opt/WeedingServer，排除 .git、node_modules 和本机 .env，在服务器安装依赖。

## 后台运行

先安装 Node.js，并用 command -v node 确认路径。service 默认 /usr/bin/node；如路径不同，修改 ExecStart 为实际绝对路径。
以下在 Ubuntu 执行，已有同名系统用户时跳过 useradd。

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin weedingserver
sudo mkdir -p /opt/WeedingServer
sudo cp -r . /opt/WeedingServer/
cd /opt/WeedingServer
sudo npm ci --omit=dev
sudo cp .env.example /etc/WeedingServer.env
sudo chmod 600 /etc/WeedingServer.env
sudo cp deploy/WeedingServer.service /etc/systemd/system/WeedingServer.service
sudo systemctl daemon-reload
sudo systemctl enable --now WeedingServer
sudo systemctl status WeedingServer --no-pager
sudo journalctl -u WeedingServer -n 100 --no-pager
```

代码目录及依赖需对 weedingserver 用户可读。systemd 读取 /etc/WeedingServer.env，不读取项目 .env；修改配置后 sudo systemctl restart WeedingServer。运行数据在内存中，无需可写数据目录。日志由 journald 管理。

腾讯云防火墙放通 TCP 8788；Ubuntu 如启用 UFW，也需放通对应来源和端口。测试阶段建议限定客户端来源 IP。
客户端测试地址：http://43.136.91.20:8788。已有客户端会保存地址，需要在连接设置更新；本次未修改 Unity 地址。

## 模块与运行限制

- server.cjs：HTTP 路由、房间和身份；room-websocket.cjs：WebSocket RPC 和推送。
- world-state.cjs、bundle-state.cjs、tool-progress-state.cjs：世界增量；snapshot-transfer.cjs：压缩分块；movement-queue.cjs：移动合并。
- 房主执行玩法，云服务转发并保存状态；房主约 15 秒无心跳房间失效，每 5 秒清理。没有房主迁移。
- 房间保存在内存，重启丢失；不含玩家数据库或云端玩法接管。
- 保留原调试接口 /diagnostics、/client-log、/debug.rpk；独立包没有 RPK，下载返回 404。正式公网开放前需处理调试接口权限、请求频率和资源上限。
- HTTPS/WSS、域名及平台白名单根据目标平台另行配置。未完成 Ubuntu 部署或异地四人真机验证。
- 测试排除了依赖 Unity WebGL 插件的测试和 Vivo 安装辅助服务；其余 Node 回归保留。测试使用 187xx 端口，避免并行运行多份。
- 源码提取自 Unity tools/lan，后续协议更新应同步所有模块及测试，勿混用客户端协议版本。
