import { useEffect, useState } from "react";
import { Download, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BrandIcon } from "@/components/BrandIcon";
import { ModelSelect } from "./ModelSelect";
import { api } from "@/lib/api";
import type { ModelMap, Provider } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  mode: "add" | "edit";
  initial?: Provider | null;
  presets: Provider[];
  onOpenChange: (o: boolean) => void;
  onSave: (p: Provider) => void;
}

const blank = (): Provider => ({
  id: "",
  name: "",
  baseUrl: "",
  authToken: "",
  defaultModel: "",
  models: [],
  modelMap: undefined,
  extraEnv: {},
  websiteUrl: "",
  iconColor: "#2563eb",
  brand: undefined,
  note: "",
  isPreset: false,
  createdAt: 0,
});

function maskToken(t: string): string {
  if (!t) return "";
  if (t.length <= 8) return "••••";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

/** Compute the settings.json object this provider would write. */
function buildPreviewConfig(form: Provider): { model?: string; env: Record<string, string> } {
  const env: Record<string, string> = {};
  if (form.baseUrl) env.ANTHROPIC_BASE_URL = form.baseUrl;
  if (form.authToken) env.ANTHROPIC_AUTH_TOKEN = maskToken(form.authToken);
  if (form.defaultModel) env.ANTHROPIC_MODEL = form.defaultModel;
  const mm = form.modelMap;
  if (mm?.opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = mm.opus;
  if (mm?.sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = mm.sonnet;
  if (mm?.haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = mm.haiku;
  const isGlm =
    form.brand === "glm" ||
    form.baseUrl.includes("bigmodel") ||
    form.baseUrl.includes("z.ai");
  const has1m =
    !!mm && [mm.opus, mm.sonnet, mm.haiku].some((v) => v?.includes("[1m]"));
  if (isGlm && has1m) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "1000000";
  for (const [k, v] of Object.entries(form.extraEnv))
    if (k.trim()) env[k.trim()] = v;
  const config: { model?: string; env: Record<string, string> } = { env };
  if (form.defaultModel) config.model = form.defaultModel;
  return config;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="flex items-center gap-2">
        {label}
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

export function ProviderFormDialog({
  open,
  mode,
  initial,
  presets,
  onOpenChange,
  onSave,
}: Props) {
  const [form, setForm] = useState<Provider>(initial ?? blank());
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial ?? blank());
      setError(null);
      setShowToken(false);
      setFetched(null);
      setFetchErr(null);
    }
  }, [open, initial]);

  const runFetch = async () => {
    if (!form.baseUrl.trim() || !form.authToken.trim()) {
      setFetchErr("请先填写 Base URL 和 API Key");
      return;
    }
    setFetching(true);
    setFetchErr(null);
    try {
      const all = await api.fetchModels(form.baseUrl, form.authToken);
      // Keep only chat/reasoner models — drop search/embedding/rerank variants
      // that can't serve as Claude Code tiers.
      const chat = all.filter((m) =>
        !/(search|embedding|embed|rerank|reranker|bge|m3-)/i.test(m),
      );
      setFetched(chat);
      setForm((f) => ({
        ...f,
        models: Array.from(new Set([...(f.models ?? []), ...chat])),
      }));
    } catch (e) {
      setFetched(null);
      setFetchErr(String(e));
    } finally {
      setFetching(false);
    }
  };

  const set = <K extends keyof Provider>(k: K, v: Provider[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setTier = (tier: keyof ModelMap, v: string) =>
    setForm((f) => ({
      ...f,
      modelMap: { ...(f.modelMap ?? {}), [tier]: v || undefined },
    }));

  const toggle1m = (tier: keyof ModelMap) => {
    const cur = form.modelMap?.[tier] ?? "";
    setTier(tier, cur.endsWith("[1m]") ? cur.slice(0, -4) : `${cur}[1m]`);
  };

  const previewConfig = buildPreviewConfig(form);

  const applyPreset = (preset: Provider) =>
    setForm((f) => ({
      ...preset,
      id: f.id,
      authToken: f.authToken,
      isPreset: false,
      createdAt: f.createdAt,
    }));

  const submit = () => {
    if (!form.name.trim()) return setError("请填写名称");
    if (!form.baseUrl.trim()) return setError("请填写 Base URL");
    if (mode === "add" && !form.authToken.trim())
      return setError("请填写 API Key");
    // drop empty extra-env keys
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(form.extraEnv))
      if (k.trim()) cleanEnv[k.trim()] = v;
    onSave({
      ...form,
      defaultModel: form.defaultModel || undefined,
      modelMap: form.modelMap,
      extraEnv: cleanEnv,
    });
  };

  const tierOptions = form.models;

  // options for the startup-default-model selector: tier models first (so the
  // user can pick opus/sonnet/haiku-mapped models), then any other known models
  const defaultModelOptions = Array.from(
    new Set(
      [
        form.modelMap?.opus,
        form.modelMap?.sonnet,
        form.modelMap?.haiku,
        ...(form.models ?? []),
      ].filter((m): m is string => !!m && !m.includes("[1m]")),
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "添加 Claude Code 供应商" : "编辑供应商"}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "选择供应商或自定义，填入 API Key 即可"
              : "编辑接入信息与模型映射"}
          </DialogDescription>
        </DialogHeader>

        {mode === "add" && (
          <div className="grid gap-1.5">
            <Label>预设供应商</Label>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    form.baseUrl === p.baseUrl
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-transparent bg-secondary text-secondary-foreground hover:bg-accent",
                  )}
                >
                  <BrandIcon brand={p.brand} color={p.iconColor} name={p.name} size={16} />
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...blank(),
                    id: f.id,
                    createdAt: f.createdAt,
                  }))
                }
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                自定义
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-3">
          <Row label="名称">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="配置名称"
            />
          </Row>
          <Row label="Base URL">
            <Input
              value={form.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              placeholder="https://open.bigmodel.cn/api/anthropic"
            />
          </Row>
          <Row label="API Key">
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={form.authToken}
                onChange={(e) => set("authToken", e.target.value)}
                placeholder="sk-..."
                className="pr-9"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowToken((s) => !s)}
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </Row>
        </div>

        {/* Tier mapping */}
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <Label>模型分层映射</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runFetch}
              disabled={fetching}
              className="h-7 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              {fetching ? "获取中…" : "获取模型"}
            </Button>
          </div>
          <span className="-mt-1 text-xs text-muted-foreground">
            映射到 Claude Code 的 Opus / Sonnet / Haiku 三档
          </span>
          {([
            ["opus", "Opus（深度）"],
            ["sonnet", "Sonnet（均衡）"],
            ["haiku", "Haiku（快速）"],
          ] as const).map(([tier, label]) => {
            const val = form.modelMap?.[tier] ?? "";
            // 1M toggle shown only for GLM model names (matches backend
            // has_1m detection: any tier containing [1m] writes the window).
            const isGlm = val.startsWith("glm");
            return (
              <div key={tier} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">
                  {label}
                </span>
                <ModelSelect
                  value={val}
                  options={tierOptions}
                  onChange={(v) => setTier(tier, v)}
                  show1m={isGlm}
                  oneMillion={val.endsWith("[1m]")}
                  onToggle1m={() => toggle1m(tier)}
                />
              </div>
            );
          })}

          {fetchErr && (
            <p className="text-[11px] text-destructive">{fetchErr}</p>
          )}
          {fetched && fetched.length > 0 && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              已获取 {fetched.length} 个模型，可在上方下拉中选择
            </p>
          )}
        </div>

        {/* Startup default model — written to the top-level `model` field
            in settings.json so Claude Code boots into it without /model. */}
        <Row label="启动默认模型" hint="Claude Code 启动时自动加载，无需 /model">
          <ModelSelect
            value={form.defaultModel ?? ""}
            options={defaultModelOptions}
            onChange={(v) => set("defaultModel", v || undefined)}
            placeholder="选择启动时默认使用的模型"
          />
        </Row>

        {/* Live config preview */}
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            配置预览
          </summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed">
            <code>{JSON.stringify(previewConfig, null, 2)}</code>
          </pre>
        </details>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            className="bg-gray-600 text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600"
            onClick={submit}
          >
            {mode === "add" ? "添加" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
