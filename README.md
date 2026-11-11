<div align="center">

<img src="images/weixin-shell-logo.svg" alt="weixin-shell Logo：后方微信气泡保留双眼，前方气泡显示 Shell 提示符" width="220">

# weixin-shell

[![npm](https://img.shields.io/npm/v/@fangjunjie/weixin-shell)](https://www.npmjs.com/package/@fangjunjie/weixin-shell)
[![CI](https://github.com/classfang/weixin-shell/actions/workflows/ci.yml/badge.svg)](https://github.com/classfang/weixin-shell/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

中文文档 | [English](README_EN.md)

</div>

通过微信 ClawBot 的原生 iLink HTTP 通道接收命令，在运行本程序的主机上执行，并把结果回复到微信。无 Agent、无大模型、无模型 API Key，不依赖 OpenClaw。唯一第三方依赖 `qrcode-terminal` 用于在终端显示二维码。

仓库：[classfang/weixin-shell](https://github.com/classfang/weixin-shell) · npm：[@fangjunjie/weixin-shell](https://www.npmjs.com/package/@fangjunjie/weixin-shell)。npm 安装命令在首次发布后可用。

## 环境

- Node.js 22.9 或更新版本。
- macOS 或 Linux；Windows 可使用 WSL，本版本不支持原生 PowerShell。
- 微信账号具备 ClawBot 接入资格，能够完成扫码确认。
- 主机可通过 HTTPS 访问微信 iLink 服务，保持在线、不休眠。无需配置入站端口或公网 IP。

## 开始使用

### 通过 npx 运行

在希望执行 Shell 命令的目录打开终端：

```sh
npx @fangjunjie/weixin-shell login
npx @fangjunjie/weixin-shell start
```

两个命令应在同一系统账号下运行；自定义 `WEIXIN_STATE_DIR` 时应保持一致。默认凭证保存在 `~/.weixin-shell`，npx 缓存变化不会丢失登录状态。

### 全局安装

```sh
npm install -g @fangjunjie/weixin-shell
weixin-shell login
weixin-shell start
```

查看帮助：`weixin-shell --help`。升级：`npm install -g @fangjunjie/weixin-shell@latest`。

### 从源码运行

```sh
git clone https://github.com/classfang/weixin-shell.git
cd weixin-shell
npm ci
cp .env.example .env
# 按需修改 .env 中的工作目录、Shell 和超时。
npm run login
```

用**本人微信**扫描终端二维码并确认；如手机显示验证码，在终端按提示输入。登录支持微信返回的 API 地址、二维码刷新和登录重定向。当前仅实现本人绑定，不实现代他人实名绑定流程。

```sh
npm start
```

在微信 ClawBot 对话里发送：

```text
/help
/status
/exec pwd
/exec uptime
/exec ls -lah
/exec cd /path/to/project && npm test
```

程序仅接受扫码绑定者的私聊文本，忽略群消息、其他发送者、文件和语音。命令按接收顺序逐条执行。每条 `/exec` 启动一个独立 Shell；目录和环境变量不跨消息保留。服务继承启动终端的环境，默认 `/bin/sh -c`，不会自动加载交互式 Shell 配置；可通过下文的启动参数配置启用别名。没有 PTY，不能输入 sudo 密码或操作 vim 等交互程序。项目名中的 shell 指本机执行，不使用 SSH 协议。

结果包含 stdout、stderr、退出码和耗时。长文本自动按 UTF-8 字节分段；默认最多收集 24000 字节，超过上限会终止命令并标记截断。超过 60 秒也会终止命令。`Ctrl+C` 或 SIGTERM 停止服务，同时终止当前命令进程组。回复在命令结束后发出，当前不提供实时输出流、后台任务管理或文件上传。

## 配置

`weixin-shell`、npx 和源码启动均自动读取**启动时当前目录**下的 `.env`，已存在的环境变量优先。无需配置时可以不创建 `.env`。源码运行可复制 [.env.example](.env.example)；npm 安装方式可在工作目录新建 `.env`：

```dotenv
WEIXIN_CWD=/path/to/project
WEIXIN_TIMEOUT_MS=60000
WEIXIN_MAX_OUTPUT_BYTES=24000
```

也可直接传入环境变量：`WEIXIN_CWD=/path/to/project weixin-shell start`。`WEIXIN_CWD` 仅控制命令工作目录，不改变 `.env` 的查找位置。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEIXIN_CWD` | 启动时的当前目录 | 执行命令的固定工作目录 |
| `WEIXIN_STATE_DIR` | `~/.weixin-shell` | 凭证、游标、执行记录和进程锁目录 |
| `WEIXIN_TIMEOUT_MS` | `60000` | 命令超时，1–3600000 毫秒 |
| `WEIXIN_MAX_OUTPUT_BYTES` | `24000` | 输出总上限，1–1048576 字节 |
| `WEIXIN_SHELL` | `/bin/sh` | Shell 可执行文件路径 |
| `WEIXIN_SHELL_ARGS` | `["-c"]` | Shell 启动参数，非空字符串组成的非空 JSON 数组；命令正文作为最后一个参数原样追加 |
| `WEIXIN_PROTOCOL_VERSION` | `3.0.1/weixin-shell-0.1.0` | 协议兼容声明；前三段对应微信插件协议版本 |

### 使用 Shell 别名

例如 `ll` 通常定义在 `~/.zshrc` 中。要让 `/exec ll` 使用该别名，在启动目录的 `.env` 同时设置：

```dotenv
WEIXIN_SHELL=/bin/zsh
WEIXIN_SHELL_ARGS='["-i","-c"]'
```

重启服务后生效，无需重新登录。使用 Bash 且别名在 `~/.bashrc` 中时，将路径改为 `/bin/bash`，参数同上。别名必须已在对应启动文件中定义；仅切换 Shell 路径不会启用交互式配置。

`WEIXIN_SHELL_ARGS` 替换默认参数，需包含 Shell 执行命令所需的 `-c`；程序不会自行补上，也不会按空格拆分参数。无效 JSON、空数组或非字符串参数会在启动时被拒绝。

交互模式会在每条命令前运行对应 Shell 的启动文件，可能增加启动耗时、附带输出，或因没有终端而产生作业控制提示。它仍不提供 PTY；启动文件应能在无终端时正常执行，避免自动进入交互程序。每条消息仍使用独立 Shell。

## 状态和恢复

数据目录权限设为 `0700`，JSON 文件使用 `0600`，原子替换并同步到磁盘。`session.json` 保存微信凭证与绑定者；`state.json` 保存游标、任务状态和待发结果。日志不打印凭证、命令正文和执行结果，但本地状态文件会包含输出，应作为敏感数据保管。目录权限不是 Shell 沙箱：命令拥有运行程序的系统账号权限。

- 收到命令后，先保存执行记录，再启动 Shell。重启时不自动重跑状态不明确的命令，而是报告中断，避免重复产生副作用。
- 发送失败时保存结果并退避重试；重启后补发，无需再次执行命令。
- 分段回复重试复用同一个 `client_id`。如果微信已收取回复、客户端尚未记录成功时崩溃，仍可能出现重复回复；不承诺端到端 exactly-once。
- 整批消息处理完成后才保存新游标；批次重放由已保存的消息 ID 去重。
- 重新登录清空游标，保留去重记录。切换绑定者后不发送旧绑定者的待发结果。不要手动删除正在使用的状态文件，否则旧命令可能再次执行。
- 执行记录目前不会自动清理，以维持持久化去重；长期大量使用时状态文件会增长。
- 待发结果补发成功前暂停接收新任务。若会话上下文失效导致长期发送失败，可停止服务后检查 `state.json` 中的结果；备份后再处理该任务状态，避免直接清空整个去重记录。
- 普通断网退避重试；会话失效（例如 `-14`）或 HTTP 401/403 停止服务，提示重新登录。
- 使用独占 `process.lock` 阻止多实例。强制杀进程或主机崩溃会留下锁；先确认锁内 PID 对应的旧进程已退出，再删除该锁文件。不要让其他客户端同时使用同一机器人凭证拉取消息。

默认超时清理适用于普通命令及其进程组；主动脱离进程组的守护进程不保证被清理。即使这些进程持有输出管道，超时、超量输出或服务停止后也会关闭管道并结束等待，不再收集后续输出。主机崩溃、SIGKILL 或终端异常退出不能保证子进程立即终止，恢复后应先检查主机再手动重发命令。

## 验证

```sh
npm test
npm run check
node src/cli.js --help
```

测试包含真实 Shell 执行、超时终止、输出限制、授权、持久化去重、补发、中断恢复、中文分段、进程锁、登录状态流程和本地 HTTP 协议请求。它们不会连接真实微信，也不会读取已有微信凭证。真实扫码和微信端收发需在有接入资格的账号下另行验证。

## 代码结构

```text
src/cli.js      启动、配置、轮询和关闭
src/ilink.js    原生 fetch 实现的 iLink 客户端
src/login.js    二维码、验证码与重定向状态流程
src/bridge.js   身份校验、命令分发和持久化回复
src/runner.js   子进程、超时、输出限制
src/state.js    私有状态存储和实例锁
test/          离线测试
```

协议依据：[腾讯 openclaw-weixin 协议说明](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)。协议文档由现有客户端实现整理，不等同于长期稳定的服务端契约；本项目独立实现，通道变更时可能需要更新。

## 参与开发与发布

提交问题和改进建议请使用 [GitHub Issues](https://github.com/classfang/weixin-shell/issues)。本地开发、验证要求及 npm 发布步骤见 [贡献指南](CONTRIBUTING.md)。安全问题请按 [安全说明](SECURITY.md) 私下报告，勿上传微信凭证或执行结果。

本项目按 [ISC 许可证](LICENSE) 开源，与腾讯、微信及 OpenClaw 无隶属或官方授权关系。仅在本人有权管理的主机上使用；绑定微信的控制权等同于运行进程账号的命令执行权限。
