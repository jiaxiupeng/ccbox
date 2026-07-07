# CCBox — 设计规格 (Design Spec)

- **日期**: 2026-06-14
- **状态**: 已通过设计评审，待实现
- **参考**: [farion1231/cc-switch](https://github.com/farion1231/cc-switch)（外观与交互克隆对象）

## 1. 概述

CCBox 是一款**轻量级**桌面工具，专为 **Claude Code** 提供 **API 供应商切换**与**使用量查看**两项核心功能。外观与 cc-switch 主界面保持一致（卡片式供应商列表、绿色"当前使用"徽标、右上角橙色"+"按钮、深浅色主题），但裁剪掉一切与本目标无关的功能，追求最小体积与最低复杂度。

### 目标 (Goals)

1. 一键切换 Claude Code 当前生效的 API 供应商（写入 `~/.claude/settings.json`）。
2. 基于本地会话日志统计使用量（token / 费用 / 请求数，按模型与日期聚合）。
3. 外观与 cc-switch 主界面一致。
4. 安装包 ≤ 15MB，启动快、占用低。

### 非目标 (Non-Goals，明确不做)

- 其它 CLI 工具支持（Codex / Gemini CLI / OpenCode / OpenClaw / Hermes 等的 tab）。
- MCP / Skills / Prompts 管理。
- 本地代理、格式转换、自动故障转移、熔断器、健康监控。
- 云同步（Dropbox / OneDrive / WebDAV 等）。
- Deep Link 导入、会话管理器、工作区编辑器。
- 任何**中转 / 聚合**类供应商预设（AiHubMix、DMXAPI、PackyCode、CherryIN 等一律排除）。
- 供应商余额接口查询（仅中转商提供，本工具不涉及）。

## 2. 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | Tauri 2 | 原生 WebView，无 Chromium，体积小 |
| 前端 | React 18 + TypeScript + Vite | 与 cc-switch 同栈，UI 还原度最高 |
| 样式 | Tailwind CSS 3 + shadcn/ui | 复刻卡片 / 徽标 / 对话框风格 |
| 后端 | Rust（serde / serde_json / dirs） | 极简依赖，不用 SQLite |
| 网络 | reqwest（仅测速/连通性，可选） | 切换本身不联网 |

**轻量化取舍**：
- 存储用 **JSON 文件 + 原子写入**，不用 SQLite（供应商仅几条，无需数据库）。
- **不引入图表库**，用量趋势用手写 SVG 柱状图。
- Rust 依赖控制在最小集合，避免二进制膨胀。

## 3. 架构

```
┌──────────────────────────────────────────────────────┐
│        前端  React + TS + Tailwind + shadcn/ui        │
│  Header · ProviderList · ProviderCard                │
│  AddProviderDialog · EditProviderDialog              │
│  UsageDashboard · Settings · Tray                    │
└───────────────────────┬──────────────────────────────┘
                        │ Tauri IPC (invoke)
┌───────────────────────▼──────────────────────────────┐
│              后端  Rust (Tauri 2)                      │
│  ProviderService  ·  ClaudeConfigWriter  ·  UsageService │
│   (providers.json      (写 ~/.claude/         (解析    │
│    原子读写)            settings.json)        日志)    │
└──────────────────────────────────────────────────────┘
```

### 数据与配置文件位置

| 路径 | 内容 |
|------|------|
| `~/.ccbox/providers.json` | CCBox 自己的供应商列表 + 当前启用 id |
| `~/.ccbox/settings.json` | CCBox 本地 UI 偏好（主题等） |
| `~/.claude/settings.json` | Claude Code 读取的配置；切换时写入其 `env` 段 |
| `~/.claude/projects/**/*.jsonl` | 使用量数据源（会话日志） |

## 4. 数据模型

### Provider（供应商）

```ts
interface Provider {
  id: string;            // uuid
  name: string;          // 显示名，如 "智谱 GLM"
  baseUrl: string;       // ANTHROPIC_BASE_URL
  authToken: string;     // ANTHROPIC_AUTH_TOKEN（存储于本地，不外传）
  defaultModel?: string; // ANTHROPIC_MODEL（可选）
  models: string[];      // 可用模型列表（用于显示/选择）
  websiteUrl?: string;   // 官网链接（卡片上展示）
  iconColor?: string;    // 卡片图标色
  note?: string;         // 备注
  isPreset?: boolean;    // 是否内置预设（不可删除，仅可编辑 key）
  createdAt: number;     // 创建时间戳
}
```

### providers.json 结构

```json
{
  "providers": [ /* Provider[] */ ],
  "activeId": "<id> | null"
}
```

## 5. 核心机制

### 5.1 供应商切换（与 cc-switch 一致）

用户点击卡片"启用"按钮时，后端：

1. 读取 `~/.claude/settings.json`（若不存在则视为 `{}`）。
2. 合并写入 `env` 字段，**仅覆盖**以下键，保留其余内容：
   - `ANTHROPIC_BASE_URL` = `provider.baseUrl`
   - `ANTHROPIC_AUTH_TOKEN` = `provider.authToken`
   - `ANTHROPIC_MODEL` = `provider.defaultModel`（若有，否则移除该键）
3. **原子写入**：先写临时文件，再 rename，避免半写入损坏配置。
4. 更新 `providers.json` 的 `activeId`。
5. 通知前端刷新启用态。

> Claude Code 支持热加载 settings，切换后无需重启终端。

### 5.2 使用量统计（本地日志解析）

1. 递归扫描 `~/.claude/projects/**/*.jsonl`。
2. 逐行解析 JSON，提取：
   - `message.usage`：`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`
   - `message.model`
   - 时间戳（`timestamp`）
3. 聚合维度：
   - 总 token、总费用、总请求数。
   - 按模型分组（明细表）。
   - 按日期分组（近 7 / 30 天趋势柱状图）。
4. 费用 = Σ(token × 模型单价)。模型单价内置默认值，设置页可改。

**性能**：日志可能较大，采用流式逐行读取，大文件不全量载入内存；提供"按日期范围/按项目目录"过滤以控制扫描量。

## 6. 内置供应商预设（仅直连，排除中转）

| 预设 | baseUrl | 常见模型 |
|------|---------|---------|
| Claude 官方 | `https://api.anthropic.com` | claude-opus-4-8 / claude-sonnet-4-6 / claude-haiku-4-5 |
| 智谱 GLM | `https://open.bigmodel.cn/api/anthropic` | glm-4.6 / glm-4.5 |
| 通义 Qwen | DashScope Anthropic 兼容端点（实现时核准） | qwen3-coder-plus |
| Kimi (Moonshot) | `https://api.moonshot.cn/anthropic` | kimi-k2 |
| **自定义** | 用户填写 | 用户填写 |

> 实现阶段会对照各厂商当前官方文档核准 Anthropic 兼容端点的精确 URL 与模型名。预设仅预填名称与 baseUrl，用户始终需自行填入 API Key。

## 7. UI 设计（复刻 cc-switch 主界面）

### 7.1 主窗口布局

```
┌──────────────────────────────────────────────────────────┐
│ CCBox            [Claude]              ⚙  ☼  ＋(橙)        │  Header
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ⋮  🔵 智谱 GLM                    [当前使用] ✓        │ │  ProviderCard（启用）
│ │     https://open.bigmodel.cn/api/anthropic            │ │  蓝边框 + 绿徽标
│ │     今日 12.3k token · ¥0.42         编辑 / 删除 / 测速 │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ⋮  🟣 Claude 官方                                     │ │  ProviderCard（未启用）
│ │     https://api.anthropic.com          编辑 / 删除 / 测速│ │
│ └──────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│  [ 供应商 ]   [ 使用量 ]              主题：深 / 浅 / 跟随   │  底部 Tab
└──────────────────────────────────────────────────────────┘
```

### 7.2 组件清单

- `Header`：标题 + 工具图标 + 主题切换 + 橙色"+"添加按钮。
- `ProviderList` → `ProviderCard`：图标、名称、baseUrl、启用徽标、当日用量摘要、`⋮` 菜单（编辑/删除/测速/启用）。
- `AddProviderDialog`：顶部预设 chips（选中高亮）+ 表单（名称/备注/官网/baseUrl/API Key/默认模型）+ 取消/添加。
- `EditProviderDialog`：同表单，预填。
- `UsageDashboard`：总额卡（token / 费用 / 请求）+ 模型明细表 + 近 7/30 天 SVG 柱状图 + 日期范围选择。
- `Settings`：主题、模型单价编辑、关于。
- `Tray`：系统托盘菜单，列出供应商一键切换（复刻 cc-switch 托盘快速切换，低成本高价值，纳入 v1）。

### 7.3 主题

深色 / 浅色 / 跟随系统，三态切换，与 cc-switch 一致。

## 8. 项目结构

```
ccbox/
├── src/                          # 前端 (React + TS)
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── providers/
│   │   │   ├── ProviderCard.tsx
│   │   │   ├── ProviderList.tsx
│   │   │   ├── AddProviderDialog.tsx
│   │   │   └── EditProviderDialog.tsx
│   │   ├── usage/
│   │   │   ├── UsageDashboard.tsx
│   │   │   ├── ModelStatsTable.tsx
│   │   │   └── TrendChart.tsx
│   │   ├── settings/SettingsPage.tsx
│   │   └── ui/                   # shadcn 组件
│   ├── hooks/
│   │   ├── useProviders.ts
│   │   ├── useUsage.ts
│   │   └── useSettings.ts
│   ├── lib/
│   │   ├── api.ts                # invoke 封装
│   │   ├── presets.ts            # 内置预设
│   │   └── types.ts
│   └── config/                   # 模型默认单价等
├── src-tauri/                    # 后端 (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── commands/             # Tauri 命令层
│       │   ├── provider.rs
│       │   ├── claude_config.rs
│       │   └── usage.rs
│       ├── services/
│       │   ├── provider_service.rs
│       │   ├── claude_config_writer.rs
│       │   └── usage_service.rs
│       ├── storage.rs            # JSON 原子读写
│       ├── models.rs             # 数据结构
│       └── presets.rs            # 内置预设（与前端一致）
├── docs/superpowers/specs/        # 本 spec
└── package.json
```

## 9. 后端 Tauri 命令（IPC 接口）

| 命令 | 入参 | 返回 | 说明 |
|------|------|------|------|
| `list_providers` | — | `Provider[]` | 读取 providers.json |
| `add_provider` | `Provider`(无 id) | `Provider` | 新增并持久化 |
| `update_provider` | `Provider` | `Provider` | 编辑 |
| `delete_provider` | `id` | `()` | 删除（当前启用的至少保留 1 个） |
| `switch_provider` | `id` | `()` | 写入 settings.json + 更新 activeId |
| `get_active_id` | — | `Option<id>` | 当前启用 |
| `get_usage` | `{range?, project?}` | `UsageReport` | 解析日志聚合用量 |
| `test_provider` | `{baseUrl, token}` | `{ok, latencyMs}` | 连通性/延迟测速（v1 纳入，便于切换前验证 key） |
| `get_settings` / `set_settings` | — / `Settings` | `Settings` | UI 偏好与模型单价 |

## 10. 测试策略

- **后端（Rust）**：
  - `storage.rs`：原子写入、并发安全、损坏文件恢复。
  - `claude_config_writer.rs`：合并写入不破坏既有字段、移除旧供应商残留键。
  - `usage_service.rs`：用样本 JSONL 验证 token/费用聚合、多模型分组、日期聚合。
- **前端**：组件渲染、启用态切换、表单校验（vitest + testing-library）。
- **手动验证**：切换后在真实 Claude Code 中确认请求走新端点；用量页与 `~/.claude` 日志对得上。

## 11. 安全与隐私

- `authToken` 仅存本地 `providers.json`，不上传、不外发（测速请求也只打 baseUrl 健康端点）。
- 切换仅读写本地文件，无网络行为。
- 写 settings.json 前自动备份上一版到 `~/.ccbox/backups/`（保留最近若干份）。

## 12. 体积与性能目标

- 安装包 ≤ 15MB（Tauri release build，strip symbols）。
- 冷启动 < 1s。
- 使用量解析：10 万行日志扫描 < 3s，内存峰值可控（流式读取）。
