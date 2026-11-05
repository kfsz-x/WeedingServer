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

## 本地 / 线上标签与容量管理（2026-11-05）

客户端房间面板新增“本地 / 线上”标签，分别保存地址；已有局域网玩法保留。对外显示本地 L-123456、线上 O-123456；线上加入需要完整 O- 前缀，本地兼容旧六位编号。协议仍为10，新增字段 networkMode 和错误 code。

**更新现有公网服务时，必须设置 WEEDING_MODE=online。** 原 /etc/WeedingServer.env 不会因拉取代码而自动更新。请把新版 .env.example 中新增配置合并到该文件，并重新安装新版 service 后重启。systemd unit 也默认设置 online；环境文件可覆盖。直接 node server.cjs 未设置模式时默认为 local，供现有局域网服务使用。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| WEEDING_MODE | local | 公网部署设 online；local 不启用容量门禁 |
| WEEDING_MAX_ROOMS | 5 | 达到后拒绝新开房，已有房间仍允许人数上限内加入 |
| WEEDING_MAX_PLAYERS | 20 | 达到后拒绝新的开房和加入 |
| WEEDING_MAX_RSS_MB | 512 | 进程驻留内存阈值，MiB |
| WEEDING_MAX_CPU_PERCENT | 85 | 相对于一个逻辑核的 CPU 百分比 |
| WEEDING_MAX_LAG_MS | 100 | 每秒采样定时器延迟阈值，毫秒 |

这些是保守测试配置，不代表已测出的云端承载能力；应根据实例内存、CPU及网络实测调整。资源阈值连续3次采样超过后暂停新准入，连续5次恢复后重新允许；不踢已有成员。/health 返回 capacity 的房间数、人数、资源采样、阈值和超载状态。服务器不自动将线上房间迁入局域网，客户端明确提示玩家选择本地模式。

正常 systemctl stop/restart 会发 SIGTERM：立即广播 SERVER_SHUTDOWN 给所有 WebSocket 客户端，HTTP 请求在5秒通知期返回同一错误码；随后关闭连接与进程。HTTP仍保持传输200，业务错误看 ok/code，兼容小游戏传输。新增开房/加入在通知期拒绝。SIGKILL、断电和网络中断无法广播，客户端按失败和超时回离线。

新版客户端收到停服通知后，房主继续自己的庭院并保存，访客重载自己的离线存档，不将房主世界保存到访客。突然断线经过请求超时与约10秒失败窗口退出。必须同步更新客户端才有标签和提示；老客户端不会自动获得这些界面。

本仓库不含游戏客户端构建产物。请先在测试环境验证更新，再部署公网；更新会终止现有房间。
