<div align="center">

# CCBox

**一个轻量的 Claude Code API 供应商切换工具 + 使用量查看器**

一键切换 Claude Code 的 API 配置（官方 / 智谱 GLM / 通义 Qwen / Kimi / DeepSeek / 自定义），并可视化统计 Token 用量与费用。基于 Tauri 2，安装包仅 ~2MB，内存占用 ~25MB。

[![版本](https://img.shields.io/github/v/release/jiaxiupeng/ccbox?label=)](https://github.com/jiaxiupeng/ccbox/releases)
[![许可证](https://img.shields.io/github/license/jiaxiupeng/ccbox?label=)](LICENSE)
[![下载量](https://img.shields.io/github/downloads/jiaxiupeng/ccbox/total?label=)](https://github.com/jiaxiupeng/ccbox/releases)
[![平台](https://img.shields.io/badge/Windows-0078D4?logo=windows11&logoColor=white)](#-下载)
[![Stars](https://img.shields.io/github/stars/jiaxiupeng/ccbox?style=social)](https://github.com/jiaxiupeng/ccbox/stargazers)

</div>

---

## 📥 下载

> 推荐下载 **Setup 安装包**，支持后续自动更新；免安装版需手动下载新版。

<div align="center">

| 类型 | 文件 | 体积 | 说明 |
|:---:|------|:---:|------|
| 🟦 **NSIS**（推荐） | `CCBox_1.0.1_x64-setup.exe` | ~1.8 MB | 双击安装，支持自动更新 |
| 🟩 MSI | `CCBox_1.0.1_x64_en-US.msi` | ~2.3 MB | 企业部署友好 |
| ⬜ 免安装版 | `ccbox.exe` | ~4.3 MB | 双击即用，不写注册表 |

**👉 [前往 Releases 页面下载](https://github.com/jiaxiupeng/ccbox/releases/latest)**

</div>

> 💡 已安装旧版本的用户，启动应用后会在标题栏收到新版本提示，点击即可一键更新，无需手动下载。

---

## ✨ 功能

### 供应商切换
- **一键切换** Claude Code 的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`，写入 `~/.claude/settings.json`
- **内置预设**（直连，无中转）：Claude 官方 / 智谱 GLM / 通义 Qwen / Kimi / DeepSeek / 自定义
- **模型分层映射**：Opus / Sonnet / Haiku → 供应商具体模型
- **1M 上下文**：GLM 模型专属，自动追加 `[1m]` 后缀 + 压缩窗口配置
- **实时配置预览**：表单内显示将写入 `settings.json` 的 `env`（密钥脱敏）
- **安全合并**：只改 env 相关字段，保留你其余所有 Claude Code 配置（插件、statusLine 等）

### 使用量统计
- **Token 用量** = `input + output + cache_read + cache_write`（与 Claude Code 计费口径一致）
- **费用估算**：按各模型 API 官方单价（人民币）计算，含缓存读写折扣
- **54 周热力图**：全年每日工作强度，GitHub 风格
- **柱状图**：按天 / 周 / 月 / 全部 切换
- **各模型明细**：按周期筛选每个模型的 Token 与费用
- **时区修正**：日志按北京时间（UTC+8）归桶，凌晨不误报

### 界面与体验
- 无边框窗口 + 自绘控制按钮，灰色系简洁主题
- 深色 / 浅色 / 跟随系统
- 添加供应商后🎉礼花效果
- 系统托盘快速切换
- **应用内自动更新**：新版本签名校验，一键下载安装

---

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 · TypeScript · Tailwind CSS · Radix UI |
| 后端 | Rust · Tauri 2 |
| 存储 | JSON 文件（`~/.ccbox/`），无数据库依赖 |
| 数据源 | 解析 `~/.claude/projects/**/*.jsonl` 会话日志（离线） |

---

## 🔧 从源码构建

**环境要求**：[Node.js](https://nodejs.org/) 18+ · [Rust](https://www.rust-lang.org/tools/install) stable · Windows MSVC 构建工具

```bash
git clone https://github.com/jiaxiupeng/ccbox.git
cd ccbox
npm install --include=dev

# 开发模式（热重载）
npx tauri dev

# 打包 release
npx tauri build
```

产物位于 `src-tauri/target/release/`。

---

## 📁 项目结构

```
ccbox/
├── src/                     # 前端（React + TypeScript）
│   ├── components/          #   UI 组件
│   │   ├── providers/       #     供应商列表、卡片、表单
│   │   ├── usage/           #     使用量仪表盘、热力图、柱状图
│   │   ├── settings/        #     设置页
│   │   └── ui/              #     基础组件
│   ├── lib/                 #   工具与 hooks
│   └── App.tsx              #   入口
├── src-tauri/               # 后端（Rust + Tauri）
│   ├── src/                 #   命令、服务、数据模型
│   └── icons/               #   应用图标（多尺寸）
├── docs/                    # 设计文档
├── scripts/                 # 图标生成脚本
└── .github/workflows/       # CI：自动发版 + 签名
```

> 根目录下的 `vite.config.ts`、`tsconfig.json`、`tailwind.config.cjs`、`postcss.config.cjs` 是前端标准构建配置，缺一不可。

---

## 🔒 安全与隐私

- **API Key 仅存本地**：`~/.ccbox/providers.json`（用户主目录，**不在仓库内**）
- **全程离线**：使用量统计只读本地日志，不联网、不上传
- **配置预览脱敏**：界面上的 `settings.json` 预览自动遮蔽密钥
- **更新包签名校验**：每个版本经 Ed25519 签名，客户端下载后自动验签，防篡改

---

## 📊 Token 统计说明

CCBox 扫描 `~/.claude/projects/` 下的 Claude Code 会话日志（`.jsonl`）：

- **Token 口径** = `input + output + cache_read + cache_write`（含缓存读，与 Claude Code 计费一致）
- **按 `message.id` 去重**：同一次 API 响应的多个内容块只计一次
- **时区**：日志时间戳为 UTC，显示时按北京时间（UTC+8）归桶
- **仅统计 Claude Code**：不包含其它工具的用量

> 进行中的会话日志可能尚未落盘，统计数字会短暂延迟，会话结束后即对齐。

---

## 📝 许可证

[MIT License](LICENSE) © 2026 CCBox

---

## 🙏 致谢

- [Tauri](https://tauri.app/) — 轻量跨平台桌面框架
- [cc-switch](https://github.com/farion1231/cc-switch) — UI 设计的灵感来源
- [shadcn/ui](https://ui.shadcn.com/) — UI 组件设计语言

> 各供应商名称与图标版权归 respective owners 所有，本项目仅用于识别。

---

## ⭐ Star History

<div align="center">

<a href="https://www.star-history.com/#jiaxiupeng/ccbox&Date" target="_blank">
  <img src="https://api.star-history.com/svg?repos=jiaxiupeng/ccbox&type=Date" alt="Star History Chart" width="600" />
</a>

<p>
<sub>📈 图表由 <a href="https://www.star-history.com">star-history.com</a> 提供。若上方图片未显示，<a href="https://www.star-history.com/#jiaxiupeng/ccbox&Date">点此直达</a> 查看。</sub>
</p>

</div>
