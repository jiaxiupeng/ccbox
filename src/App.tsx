import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { X } from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { ProviderList } from "@/components/providers/ProviderList";
import { ProviderFormDialog } from "@/components/providers/ProviderFormDialog";
import { UsageDashboard } from "@/components/usage/UsageDashboard";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { StatusBarPage } from "@/components/statusbar/StatusBarPage";
import { UpdateDialog } from "@/components/UpdateDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { celebrate } from "@/lib/confetti";
import { useUpdateChecker } from "@/lib/useUpdateChecker";
import type { Provider } from "@/lib/types";

type Tab = "providers" | "usage" | "statusbar" | "settings";

export default function App() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [presets, setPresets] = useState<Provider[]>([]);
  // providers / usage / statusbar are in-content tabs; settings stays an overlay.
  const [tab, setTab] = useState<"providers" | "usage" | "statusbar">("providers");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("add");
  const [editing, setEditing] = useState<Provider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  // Auto-update: silent check 3s after startup; badge in header when ready.
  const {
    hasUpdate,
    updateInfo,
    checking: updateChecking,
    downloading,
    progress,
    checkForUpdates,
    downloadAndInstall,
  } = useUpdateChecker();
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  // Manual check from settings: surface the result via toast, open the dialog
  // if an update is available.
  const handleManualCheck = useCallback(async () => {
    const res = await checkForUpdates({ silent: false });
    if (res.status === "available") {
      setUpdateDialogOpen(true);
    } else if (res.status === "upToDate") {
      toast.success("当前已是最新版本");
    } else {
      toast.error(`检查更新失败：${res.message}`);
    }
  }, [checkForUpdates]);

  const refresh = useCallback(async () => {
    const [list, active] = await Promise.all([
      api.listProviders(),
      api.getActiveId(),
    ]);
    setProviders(list);
    setActiveId(active);
  }, []);

  useEffect(() => {
    refresh().catch((e) => toast.error(`加载失败：${e}`));
    api.listPresets().then(setPresets).catch(() => {});
    // Silent update check shortly after launch; failures stay quiet.
    const timer = setTimeout(() => {
      checkForUpdates({ silent: true }).catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, [refresh, checkForUpdates]);

  const openAdd = () => {
    setDialogMode("add");
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (p: Provider) => {
    setDialogMode("edit");
    setEditing(p);
    setDialogOpen(true);
  };

  const handleSave = async (p: Provider) => {
    try {
      const isAdd = dialogMode === "add";
      if (isAdd) await api.addProvider(p);
      else await api.updateProvider(p);
      setDialogOpen(false);
      await refresh();
      toast.success(isAdd ? "已添加供应商" : "已保存修改");
      if (isAdd) celebrate();
    } catch (e) {
      toast.error(`保存失败：${e}`);
    }
  };

  const handleSwitch = async (id: string) => {
    try {
      const p = await api.switchProvider(id);
      await refresh();
      toast.success(`已切换到 ${p.name}`);
    } catch (e) {
      toast.error(`切换失败：${e}`);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteProvider(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
      toast.success("已删除");
    } catch (e) {
      toast.error(`删除失败：${e}`);
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* seamless title bar — logo + name + window controls */}
      <Header
        hasUpdate={hasUpdate}
        updateInfo={updateInfo}
        onUpdateClick={() => setUpdateDialogOpen(true)}
      />

      {/* content area */}
      <div className="flex-1 overflow-auto">
        {tab === "providers" && (
          <ProviderList
            providers={providers}
            activeId={activeId}
            onSwitch={handleSwitch}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            onReordered={refresh}
          />
        )}
        {tab === "usage" && <UsageDashboard />}
        {tab === "statusbar" && <StatusBarPage />}
      </div>

      {/* bottom navigation + floating add button */}
      <BottomNav
        tab={tab}
        onTab={(t) => (t === "settings" ? setSettingsOpen(true) : setTab(t))}
        onAdd={openAdd}
      />

      {/* settings — full-screen overlay covering the bottom nav too */}
      {settingsOpen && (
        <SettingsOverlay
          onClose={() => setSettingsOpen(false)}
          onManualCheck={handleManualCheck}
          onUpdateClick={() => setUpdateDialogOpen(true)}
          hasUpdate={hasUpdate}
          updateChecking={updateChecking}
        />
      )}

      <UpdateDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        updateInfo={updateInfo}
        downloading={downloading}
        progress={progress}
        onDownloadAndInstall={downloadAndInstall}
      />

      <ProviderFormDialog
        open={dialogOpen}
        mode={dialogMode}
        initial={editing}
        presets={presets}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除供应商？</DialogTitle>
            <DialogDescription>
              将永久删除「{deleteTarget?.name}」，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Toaster richColors position="bottom-center" />
    </div>
  );
}

/** Full-screen settings overlay with a prominent 退出 button in the top-left.
 *  Covers everything below it, including the bottom nav. */
function SettingsOverlay({
  onClose,
  onManualCheck,
  onUpdateClick,
  hasUpdate,
  updateChecking,
}: {
  onClose: () => void;
  onManualCheck: () => void;
  onUpdateClick: () => void;
  hasUpdate: boolean;
  updateChecking: boolean;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={onClose}
          aria-label="退出设置"
          className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-secondary-foreground transition-colors hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">设置</span>
      </div>
      <div className="flex-1 overflow-auto">
        <SettingsPage
          hasUpdate={hasUpdate}
          updateChecking={updateChecking}
          onManualCheck={onManualCheck}
          onUpdateClick={onUpdateClick}
        />
      </div>
    </div>
  );
}
