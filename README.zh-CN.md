<p align="center">
  <img src="assets/icon.png" width="80" />
</p>

<h1 align="center">Skills Manager</h1>

<p align="center">
  一个应用，统一管理所有 AI 编码工具的 Skills。
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

<p align="center">
  <img src="assets/demo-zh.gif" width="800" alt="Skills Manager 演示" />
</p>

| 我的 Skills | 项目 Skills |
|:-----------:|:----------:|
| <img src="assets/CleanShot_20260419_003504@2x.png" width="400" alt="我的 Skills" /> | <img src="assets/CleanShot_20260419_003526@2x.png" width="400" alt="项目 Skills" /> |

## 功能

- **统一技能库** — 从 Git 仓库、本地目录、`.zip` / `.skill` 文件或 [skills.sh](https://skills.sh) 市场安装技能，统一存放在 `~/.skills-manager`。
- **Preset（预设）** — 将技能分组为命名 Preset。在任意工作区点击 Preset 标签，即可一键为当前 Agent 范围激活或停用其全部技能，激活的 Preset 显示 ✓，部分安装显示数量。
- **全局工作区** — 按 Agent 浏览和管理全局安装的 Skills。在侧边栏切换 Agent，或通过「全部 Agents」总览跨所有已安装 Agent 统一管理。
- **项目工作区** — 查看并管理任意项目的本地 Skills 目录，支持与中央库双向同步。支持嵌套 Skill 目录和导出时按 Agent 分配。
- **关联工作区** — 将任意目录指定为 Skills 根目录，适合管理不在默认 Agent 路径下的 Skills。作为独立工作区管理，不参与全局 Preset 同步。
- **多工具同步** — 一键将技能同步到任意支持的工具，支持软链接和复制两种模式。
- **批量操作** — 多选技能后批量启用/禁用、导出或删除。项目工作区中的项目 Skills 也支持批量启用/禁用。
- **技能标签** — 为技能添加标签，用于归类同类技能，并按标签筛选，快速定位。
- **更新检查** — 为 Git 类技能检查远端更新；本地技能支持重新导入。
- **文档预览** — 直接在应用内查看 `SKILL.md` / `README.md`。
- **自定义工具** — 添加自定义 Agent/工具并指定 Skills 目录，也可覆盖内置工具的默认路径。
- **Git 备份** — 用 Git 管理技能库，支持版本控制和多机同步。

## 核心概念

- **Preset 是可复用的 Skills 分组** — Preset 是一组命名的 Skills 集合。在任意工作区激活 Preset，即可将其所有 Skills 添加到选定 Agent；停用则反向移除。应用 Preset 是一次性复制，不是实时同步。
- **全局工作区管理每个 Agent 的全局 Skills** — 每个已安装 Agent 都有自己的全局 Skills 目录（如 Claude Code 对应 `~/.claude/skills/`）。在全局工作区中查看、添加和移除 Skills，或从「全部 Agents」总览跨 Agent 统一管理。
- **项目工作区是项目专属 Skills 集合** — 项目工作区管理某个项目里的本地 Skills（如 `<project>/.claude/skills/`），只对该项目生效。
- **标签用于归类和筛选** — 给同类 Skills 打上相同标签后，可以按标签快速筛选出需要的一组 Skills。
- **批量操作随处可用** — 在任意工作区多选 Skills，进行批量操作。

## 快速上手

1. 从本地目录、Git 仓库、压缩包或市场安装 Skills。如有 SkillsMP API Key，还可开启 AI 搜索。
2. 从侧边栏进入 **全局工作区**，选择一个 Agent（如 Claude Code）。
3. 点击 **Preset** 标签，一键为该 Agent 激活对应 Skills。激活的 Preset 显示 ✓，部分安装显示计数角标。
4. 如需管理项目本地 Skills，打开 **项目工作区**，同样使用 Preset 标签，或单独添加 Skills。
5. 在 **设置** 中配置 Agent 路径、自定义工具、主题、语言、代理和 Git 偏好。
6. 如果需要历史版本或多机同步，先在 **设置** 保存 Git 远程地址，再到 **我的 Skills** 执行 **开始备份** 或 **同步到 Git**。

## Git 备份

将 `~/.skills-manager/skills/` 备份到 Git 仓库，用于版本管理和多机同步。

### 快速配置

1. 创建一个私有仓库（推荐）。
2. 打开 **设置 → Git 同步配置**，保存远程仓库地址。
3. 打开 **我的 Skills** 页面。
4. 二选一：
- 已有远程仓库：点击 **开始备份**，按已配置地址克隆。
- 首次本地初始化：点击 **开始备份** 初始化本地仓库，再使用 **同步到 Git**。
5. 在我的 Skills 顶部工具栏点击 **同步到 Git**。

`同步到 Git` 会根据仓库状态自动处理拉取/提交/推送。
每次同步成功会自动创建一个快照版本标签。你可以在我的 Skills 中打开 **版本历史**，并将任意快照恢复为一条新的提交。

### 认证说明

- SSH 地址（`git@github.com:...`）：需要先在本机配置 SSH Key，并将公钥添加到 GitHub。
- HTTPS 地址（`https://github.com/...`）：推送通常需要 Personal Access Token（PAT）。

> **注意：** SQLite 数据库（`~/.skills-manager/skills-manager.db`）不纳入 Git 管理，它存储的元数据可通过扫描技能文件重建。

## 支持的工具

Cursor · Claude Code · Codex · OpenCode · Amp · Kilo Code · Roo Code · Goose · Gemini CLI · GitHub Copilot · Windsurf · TRAE IDE · Antigravity · Clawdbot · Droid

你也可以在**设置**中添加自定义工具，以相同方式管理其 Skills。

## 应用内帮助

设置页中的 **帮助** 按钮会展示与上面一致的快速流程，方便用户不离开应用也能快速理解使用方式。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19、TypeScript、Vite、Tailwind CSS |
| 桌面 | Tauri 2 |
| 后端 | Rust |
| 存储 | SQLite（`rusqlite`） |
| 国际化 | react-i18next |

## 快速开始

### 前置依赖

- Node.js 18+
- Rust 工具链
- 当前系统的 [Tauri 依赖](https://v2.tauri.app/start/prerequisites/)

### 开发

```bash
npm install
npm run tauri:dev
```

### CLI

仓库现在包含一个面向 agent 的 CLI，而且它是建立在与桌面应用共用的 Rust shared core 之上。也就是：repo 初始化、tool 解析、scenario 同步/应用逻辑，以及 metadata reindex，都被抽到了可复用 core 模块中，而不是另外在 CLI 里重写一份。

```bash
# 查看当前仓库路径和统计信息
npm run cli -- repo status

# 列出技能 / 查看单个技能
npm run cli -- skills list
npm run cli -- skills show db

# 用 shared core 预览或应用某个 scenario
npm run cli -- scenarios list
npm run cli -- scenarios preview Default
npm run cli -- scenarios apply Default

# 导出单个技能到其他 agent 工作目录
npm run cli -- skills export db --dest ~/.claude/skills/db

# 查看或同步 git 管理的 skills 仓库
npm run cli -- git status
npm run cli -- git pull
npm run cli -- git commit -m "chore: update skills"
```

可用命令分组：
- `repo`：查看或修改当前 base directory
- `tools`：列出已检测到的工具目标与路径
- `skills`：列出、查看、导出技能
- `scenarios`：列出 scenario、预览同步目标，或将某个 scenario 应用到默认工具路径
- `git`：操作 git 管理的 `skills/` 仓库（`clone`、`pull`、`push`、`commit`、`versions`、`restore`）

额外参数：
- `--skills-root <path>`：直接针对某个已 clone / 已导出的 skills repo 操作，而不是本机 app 默认目录。manager 的状态（DB、scenarios、cache、logs）会落在 `~/.skills-manager/external/<name>-<hash>/`，按 skills root 的规范化路径分目录隔离，外部仓库本身保持干净。
- `--json`：给脚本 / agent 使用的机器可读输出

```bash
npm run -s cli -- --skills-root /path/to/my-skills --json skills list
```

#### 把 CLI 二进制安装到 PATH

如果 agent / 脚本直接调用 `skills-manager-cli`（而不是 `npm run`），需要先把二进制放到 PATH 上：

```bash
npm run cli:install
# 等价于：
# cargo install --path src-tauri --bin skills-manager-cli --locked --force
```

二进制会装到 `~/.cargo/bin/skills-manager-cli`。代码更新后再跑一次即可刷新。

#### 与桌面应用并发使用

CLI 和桌面应用共享同一个 SQLite 数据库。SQLite 会串行化写入，所以数据是安全的，但运行中的应用不会自动刷新它的内存缓存 —— 在 CLI 跑完 `scenarios apply`、`git pull` 等会改状态的命令后，重启应用或手动刷新一次。

### 构建

```bash
npm run tauri:build
npm run cli:build
```

## 常见问题

### macOS 提示"应用已损坏，无法打开"

下载应用后如果出现此提示，在终端执行以下命令后重新打开即可：

```bash
xattr -cr /Applications/skills-manager.app
```

如果 `.app` 不在 `/Applications`，请替换为实际路径。

## License

MIT
