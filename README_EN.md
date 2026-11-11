<div align="center">

<img src="images/weixin-shell-logo.svg" alt="weixin-shell logo: rear WeChat bubble with eyes and front bubble with a shell prompt" width="220">

# weixin-shell

[![npm](https://img.shields.io/npm/v/@fangjunjie/weixin-shell)](https://www.npmjs.com/package/@fangjunjie/weixin-shell)
[![CI](https://github.com/classfang/weixin-shell/actions/workflows/ci.yml/badge.svg)](https://github.com/classfang/weixin-shell/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

[中文文档](README.md) | English

</div>

Receive commands through WeChat ClawBot's native iLink HTTP channel, execute them on the host running this program, and reply with the results. No agent, LLM, model API key, or OpenClaw installation is required. The only third-party dependency is `qrcode-terminal`, used to display login QR codes.

Repository: [classfang/weixin-shell](https://github.com/classfang/weixin-shell). npm: [@fangjunjie/weixin-shell](https://www.npmjs.com/package/@fangjunjie/weixin-shell). npm installation becomes available after the first release. Runtime prompts and replies are currently in Chinese.

## Requirements

- Node.js 22.9 or newer.
- macOS or Linux; use WSL on Windows. Native PowerShell is not supported.
- A WeChat account eligible for ClawBot access and QR-code login.
- An online host with outbound HTTPS access to WeChat iLink. No inbound port or public IP is required. Keep the host awake.

## Installation and usage

Open a terminal in the directory where commands should run:

```sh
npx @fangjunjie/weixin-shell login
npx @fangjunjie/weixin-shell start
```

Alternatively, install globally:

```sh
npm install -g @fangjunjie/weixin-shell
weixin-shell login
weixin-shell start
```

Show help with `weixin-shell --help`; update with `npm install -g @fangjunjie/weixin-shell@latest`.

To run from source:

```sh
git clone https://github.com/classfang/weixin-shell.git
cd weixin-shell
npm ci
cp .env.example .env
# Adjust the working directory, shell and limits as needed.
npm run login
npm start
```

Scan the terminal QR code with **your own WeChat account** and confirm on your phone. If a verification code appears, enter it in the terminal. Login handles refreshed QR codes and redirects. Binding on behalf of another person is not implemented.

Use the same OS account for login and startup, and the same `WEIXIN_STATE_DIR` if customized. Credentials default to `~/.weixin-shell`, outside the npx cache.

Send messages in your private ClawBot conversation:

```text
/help
/status
/exec pwd
/exec uptime
/exec ls -lah
/exec cd /path/to/project && npm test
```

Only private text messages from the bound account are accepted. Group messages, other senders, files and voice messages are ignored. Commands run sequentially, each in a separate shell. Directory changes and environment changes do not persist across messages. The default is `/bin/sh -c`, inheriting the service's environment without loading interactive shell profiles. Custom startup arguments can enable aliases as described below. There is no PTY or support for interactive programs such as vim or sudo password prompts. Execution is local to the host; SSH is not used.

Replies include stdout, stderr, exit code and elapsed time. Long replies are split by UTF-8 byte length and sent after execution completes. The default output limit is 24000 bytes; exceeding it terminates the command and marks the result as truncated. The default timeout is 60 seconds. Ctrl+C or SIGTERM stops the service and terminates the current command's process group. Streaming output, background job management and file uploads are not implemented.

## Configuration

All startup methods load `.env` from the **current launch directory**, preserving existing environment variables. The file is optional. See [.env.example](.env.example), or create a `.env` in your working directory:

```dotenv
WEIXIN_CWD=/path/to/project
WEIXIN_TIMEOUT_MS=60000
WEIXIN_MAX_OUTPUT_BYTES=24000
```

You can also use `WEIXIN_CWD=/path/to/project weixin-shell start`. `WEIXIN_CWD` changes the command working directory, not the `.env` lookup location.

| Variable | Default | Description |
| --- | --- | --- |
| `WEIXIN_CWD` | Launch directory | Fixed working directory for commands |
| `WEIXIN_STATE_DIR` | `~/.weixin-shell` | Credentials, cursor, execution records and process lock |
| `WEIXIN_TIMEOUT_MS` | `60000` | Timeout, 1–3600000 milliseconds |
| `WEIXIN_MAX_OUTPUT_BYTES` | `24000` | Combined output limit, 1–1048576 bytes |
| `WEIXIN_SHELL` | `/bin/sh` | Shell executable path |
| `WEIXIN_SHELL_ARGS` | `["-c"]` | Nonempty JSON array of nonempty strings; the command is appended unchanged as the final argument |
| `WEIXIN_PROTOCOL_VERSION` | `3.0.1/weixin-shell-0.1.0` | Compatibility declaration; the first three components refer to the WeChat plugin protocol |

### Shell aliases

To use aliases such as `ll` defined in `~/.zshrc`, set both variables in the launch directory's `.env`:

```dotenv
WEIXIN_SHELL=/bin/zsh
WEIXIN_SHELL_ARGS='["-i","-c"]'
```

Restart the service, then send `/exec ll`. No new login is needed. For Bash aliases in `~/.bashrc`, use `/bin/bash` with the same arguments. The alias must already exist in the corresponding startup file; changing the executable alone does not load interactive configuration.

`WEIXIN_SHELL_ARGS` replaces the default arguments. Include the shell's command execution option (`-c`); the program does not add it or split arguments on spaces. Invalid JSON, empty arrays and non-string arguments are rejected at startup.

Interactive mode runs startup files for every command. This can add latency, extra output or job-control warnings without a terminal. It does not provide a PTY. Startup files should work without a terminal and avoid launching interactive programs. Each message still starts a separate shell.

## State and recovery

The state directory uses mode `0700`; JSON files use `0600` with atomic replacement and disk synchronization. `session.json` stores credentials and the bound account; `state.json` stores the cursor, execution records and pending results. Logs omit credentials, command bodies and results, but state files contain output and must be protected. These permissions do not provide a shell sandbox: commands have the OS account's privileges.

- Execution records are persisted before starting the shell. After a restart, uncertain commands are reported as interrupted instead of being rerun.
- Failed replies are stored and retried with backoff, including after restart, without rerunning commands.
- Reply retries reuse `client_id`. A crash after delivery but before recording success may still cause duplicate replies; end-to-end exactly-once delivery is not guaranteed.
- The cursor is saved after processing an entire batch. Persisted message IDs deduplicate replayed batches.
- Logging in again resets the cursor but preserves deduplication records. Pending replies for a previous owner are not sent to a newly bound account. Do not delete active state files: old commands could run again.
- Execution records are not automatically pruned, so the state file grows with use.
- Pending replies must be delivered before new commands are received. If expired context prevents delivery indefinitely, stop the service, back up and inspect `state.json`, then address the affected job without clearing all deduplication records.
- Network errors retry with backoff. Session expiration (such as `-14`) or HTTP 401/403 stops the service and requires login again.
- `process.lock` prevents concurrent instances. After SIGKILL or a host crash, verify that the old PID no longer belongs to a running instance before removing a stale lock. Do not share polling credentials with another client.

Timeout cleanup applies to ordinary commands and their process groups. Daemons that detach from the process group are not guaranteed to be terminated. Even if they retain output pipes, a timeout, output overflow or service stop closes the pipes and ends the wait; later output is not collected. Host crashes, SIGKILL and abnormal terminal exits may leave child processes running; inspect the host before manually resending commands.

## Development

```sh
npm test
npm run check
node src/cli.js --help
```

Offline tests cover real shell execution, timeouts, output limits, authorization, persistent deduplication, reply retries, interrupted recovery, UTF-8 splitting, process locks, login flows and local HTTP protocol requests. Tests do not contact WeChat or read existing credentials. Real QR login and messaging require manual verification with an eligible account.

```text
src/cli.js      Startup, configuration, polling and shutdown
src/ilink.js    Native-fetch iLink client
src/login.js    QR code, verification and redirect flow
src/bridge.js   Authorization, dispatch and persistent replies
src/runner.js   Child processes, timeout and output limits
src/state.js    Private state storage and instance lock
test/          Offline tests
```

Protocol reference: [Tencent openclaw-weixin protocol documentation](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md). This documentation describes an existing client implementation and is not a guarantee of a stable server contract. Channel changes may require updates.

See [CONTRIBUTING.md](CONTRIBUTING.md) (Chinese) for contribution and npm release instructions. Report issues through [GitHub Issues](https://github.com/classfang/weixin-shell/issues). Report vulnerabilities privately following [SECURITY.md](SECURITY.md); do not post credentials or sensitive output.

Licensed under [ISC](LICENSE). This project is independent of Tencent, WeChat and OpenClaw, without official affiliation or authorization. Use it only on hosts you are authorized to manage. Control of the bound WeChat account grants command execution with the service account's privileges.
