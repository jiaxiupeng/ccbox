use crate::models::{ModelMap, ModelPricing, Provider};
use std::collections::HashMap;

/// Built-in provider templates shown in the "add provider" dialog.
/// Direct API providers only — no relay/aggregation services.
/// `auth_token` is intentionally empty; the user supplies their own key.
pub fn preset_providers() -> Vec<Provider> {
    vec![
        Provider {
            id: "preset-claude-official".into(),
            name: "Claude 官方".into(),
            base_url: "https://api.anthropic.com".into(),
            auth_token: String::new(),
            default_model: Some("claude-sonnet-4-6".into()),
            models: vec![
                "claude-opus-4-8".into(),
                "claude-sonnet-4-6".into(),
                "claude-haiku-4-5".into(),
            ],
            model_map: Some(ModelMap {
                opus: Some("claude-opus-4-8".into()),
                sonnet: Some("claude-sonnet-4-6".into()),
                haiku: Some("claude-haiku-4-5".into()),
            }),
            extra_env: HashMap::new(),
            website_url: Some("https://www.anthropic.com".into()),
            icon_color: Some("#D97757".into()),
            brand: Some("claude".into()),
            note: Some("Anthropic 官方 API（直连）".into()),
            is_preset: true,
            created_at: 0,
        },
        // 智谱 GLM 官方 Claude Code 配方（1M 上下文）：
        //   opus/sonnet -> glm-5.2[1m], haiku -> glm-4.5-air
        //   one_million=true → 切换时自动写入 CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000
        Provider {
            id: "preset-glm".into(),
            name: "智谱 GLM".into(),
            base_url: "https://open.bigmodel.cn/api/anthropic".into(),
            auth_token: String::new(),
            default_model: Some("glm-5.2".into()),
            models: vec![
                "glm-5.2[1m]".into(),
                "glm-5.2".into(),
                "glm-5".into(),
                "glm-4.5-air".into(),
            ],
            model_map: Some(ModelMap {
                opus: Some("glm-5.2[1m]".into()),
                sonnet: Some("glm-5.2[1m]".into()),
                haiku: Some("glm-4.5-air".into()),
            }),
            extra_env: HashMap::new(),
            website_url: Some("https://open.bigmodel.cn".into()),
            icon_color: Some("#3B6EFF".into()),
            brand: Some("glm".into()),
            note: Some("智谱 GLM · 1M 上下文（[1m] 后缀 + 自动压缩窗口）".into()),
            is_preset: true,
            created_at: 0,
        },
        Provider {
            id: "preset-qwen".into(),
            name: "通义 Qwen".into(),
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
            auth_token: String::new(),
            default_model: Some("qwen3-coder-plus".into()),
            models: vec![
                "qwen3-coder-plus".into(),
                "qwen-max".into(),
                "qwen-plus".into(),
                "qwen-turbo".into(),
            ],
            model_map: Some(ModelMap {
                opus: Some("qwen3-coder-plus".into()),
                sonnet: Some("qwen3-coder-plus".into()),
                haiku: Some("qwen-turbo".into()),
            }),
            extra_env: HashMap::new(),
            website_url: Some("https://help.aliyun.com/zh/model-studio/claude-code".into()),
            icon_color: Some("#615CED".into()),
            brand: Some("qwen".into()),
            note: Some("阿里云百炼 Anthropic 兼容（URL 若不符请核对官方文档）".into()),
            is_preset: true,
            created_at: 0,
        },
        Provider {
            id: "preset-kimi".into(),
            name: "Kimi".into(),
            base_url: "https://api.moonshot.ai/anthropic".into(),
            auth_token: String::new(),
            default_model: Some("kimi-k2".into()),
            models: vec!["kimi-k2".into()],
            model_map: Some(ModelMap {
                opus: Some("kimi-k2".into()),
                sonnet: Some("kimi-k2".into()),
                haiku: Some("kimi-k2".into()),
            }),
            extra_env: HashMap::new(),
            website_url: Some("https://platform.kimi.ai".into()),
            icon_color: Some("#111827".into()),
            brand: Some("kimi".into()),
            note: Some("Moonshot Kimi K2 Anthropic 兼容端点".into()),
            is_preset: true,
            created_at: 0,
        },
        // DeepSeek 官方 Anthropic 兼容端点（api.deepseek.com/anthropic）。
        // 该端点目前主要支持 deepseek-chat；如需深度推理可把 opus 改为 deepseek-reasoner。
        Provider {
            id: "preset-deepseek".into(),
            name: "DeepSeek".into(),
            base_url: "https://api.deepseek.com/anthropic".into(),
            auth_token: String::new(),
            default_model: Some("deepseek-chat".into()),
            models: vec!["deepseek-chat".into(), "deepseek-reasoner".into()],
            model_map: Some(ModelMap {
                opus: Some("deepseek-chat".into()),
                sonnet: Some("deepseek-chat".into()),
                haiku: Some("deepseek-chat".into()),
            }),
            extra_env: HashMap::new(),
            website_url: Some("https://api-docs.deepseek.com/guides/anthropic_api".into()),
            icon_color: Some("#5786FE".into()),
            brand: Some("deepseek".into()),
            note: Some("DeepSeek 官方 Anthropic 兼容端点（默认 deepseek-chat）".into()),
            is_preset: true,
            created_at: 0,
        },
    ]
}

/// Default per-model pricing (USD per 1M tokens). Baseline for cost estimates;
/// user overrides in settings take precedence. Keys are model prefixes.
/// Built-in per-model pricing, in **CNY per 1,000,000 tokens** (matching the
/// app's display currency, so no USD→CNY conversion is applied downstream).
///
/// Several models are tiered by input length; we use the **0–32K short-context
/// tier** (the common Claude Code case) as the flat rate. Update in Settings if
/// you need the long-context tier.
pub fn default_pricing() -> HashMap<String, ModelPricing> {
    let mut m = HashMap::new();
    // Claude 官方 — 折算为人民币（官方美元价 × ~7.2）
    m.insert(
        "claude-opus".into(),
        ModelPricing { input_per_m: 108.0, output_per_m: 540.0, cache_read_per_m: 10.8, cache_write_per_m: 135.0 },
    );
    m.insert(
        "claude-sonnet".into(),
        ModelPricing { input_per_m: 21.6, output_per_m: 108.0, cache_read_per_m: 2.16, cache_write_per_m: 27.0 },
    );
    m.insert(
        "claude-haiku".into(),
        ModelPricing { input_per_m: 5.76, output_per_m: 28.8, cache_read_per_m: 0.58, cache_write_per_m: 7.2 },
    );
    // 智谱 GLM-5.2 — 官方 1M-token 单价（CNY）：输入 ¥8 / 输出 ¥28 /
    // 缓存读限时免费 ¥0 / 缓存写 ¥2。前缀最长匹配，优先于下面的 "glm" 兜底。
    m.insert(
        "glm-5.2".into(),
        ModelPricing { input_per_m: 8.0, output_per_m: 28.0, cache_read_per_m: 0.0, cache_write_per_m: 2.0 },
    );
    // 智谱 GLM 其它型号（glm-4.5-air 等）— 0–32K 短上下文档（官方：¥6 输入 / ¥24 输出 / ¥1.3 缓存读 / 缓存写免费）
    m.insert(
        "glm".into(),
        ModelPricing { input_per_m: 6.0, output_per_m: 24.0, cache_read_per_m: 1.3, cache_write_per_m: 0.0 },
    );
    // 通义 Qwen3-Coder-Plus — 0–32K 档（约 ¥4 输入 / ¥16 输出）
    m.insert(
        "qwen".into(),
        ModelPricing { input_per_m: 4.0, output_per_m: 16.0, cache_read_per_m: 1.0, cache_write_per_m: 2.0 },
    );
    // Kimi K2（Moonshot 官方：约 ¥4 输入 / ¥16 输出）
    m.insert(
        "kimi".into(),
        ModelPricing { input_per_m: 4.0, output_per_m: 16.0, cache_read_per_m: 0.5, cache_write_per_m: 2.0 },
    );
    // DeepSeek-Chat（V3）— 缓存未命中输入 / 输出
    m.insert(
        "deepseek".into(),
        ModelPricing { input_per_m: 2.0, output_per_m: 8.0, cache_read_per_m: 0.5, cache_write_per_m: 0.0 },
    );
    // 兜底
    m.insert(
        "default".into(),
        ModelPricing { input_per_m: 7.0, output_per_m: 21.0, cache_read_per_m: 1.4, cache_write_per_m: 8.75 },
    );
    m
}
