# 贡献与发布

## 本地开发

需要 Node.js 22.9 或更新版本，以及 macOS / Linux（Windows 使用 WSL）。

```sh
git clone https://github.com/classfang/weixin-shell.git
cd weixin-shell
npm ci
npm run check
npm test
```

项目使用原生 ESM JavaScript，无需编译。提交 `package-lock.json`，依赖变动后同步更新锁文件。CI 在 Linux 和 macOS 上运行语法检查、离线测试与打包预览。

修改功能时同步更新中文和英文 README；涉及命令执行、身份校验、持久化或协议流程时，补充对应的离线回归测试。真实微信登录和收发需另行人工验证，CI 不使用真实账号。

Issue / PR 请说明场景、预期行为、实际行为、Node.js 版本及系统；修复类 PR 应附验证结果。日志和截图应移除凭证、二维码、用户标识、命令及敏感输出。安全问题见 [SECURITY.md](SECURITY.md)。

## npm 发布（维护者）

包名沿用同作者项目的 scope：`@fangjunjie/weixin-shell`，可执行命令为 `weixin-shell`。使用 ISC 许可证，发布到公共 npm registry。

1. 确保有 `@fangjunjie` scope 的发布权限，完成 `npm login --registry=https://registry.npmjs.org/`，使用 `npm whoami --registry=https://registry.npmjs.org/` 确认账号。
2. 确认版本及文档。首次发布使用 `0.1.0`；后续发布前执行 `npm version patch`（或 `minor` / `major`，需在已初始化的 Git 仓库且工作区干净时执行）。协议中的兼容版本独立于包版本；`src/ilink.js` 和 `.env.example` 中包含客户端版本的声明也需检查。
3. 执行下列检查，确认打包文件仅包含运行源码、配置示例、Logo、许可证、中英文 README、贡献指南和安全说明：

   ```sh
   npm ci
   npm run check
   npm test
   npm pack --dry-run
   npm publish --dry-run
   ```

4. 可用 `npm pack` 生成 `.tgz`，在临时目录通过 `npm install -g /绝对路径/fangjunjie-weixin-shell-<版本>.tgz --prefix /临时安装目录` 安装，用 `/临时安装目录/bin/weixin-shell --help` 验证命令入口。
5. 确认后执行 `npm publish`，按 npm 提示完成身份验证。`publishConfig.access=public` 已设置，`prepublishOnly` 会再次运行语法检查和离线测试。成功后推送提交和对应版本标签，按需创建 GitHub Release。

`files` 白名单控制 npm 包内容，避免发布 `.env`、凭证、测试目录或开发工具配置；每次仍应检查打包清单。源码及测试保留在 GitHub。项目不配置自动发布工作流，CI 仅进行验证，不需要 npm 发布令牌。

配置字段及发布行为参考 [npm package.json 文档](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)。首次发布前需由维护者确认包名可用及 scope 权限，仓库地址应为 `classfang/weixin-shell`。
