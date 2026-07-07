import { Server } from "lucide-react";
import { ProviderCard } from "./ProviderCard";
import { api } from "@/lib/api";
import { move, useReorder } from "@/lib/useReorder";
import { toast } from "sonner";
import type { Provider } from "@/lib/types";

interface Props {
  providers: Provider[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onEdit: (p: Provider) => void;
  onDelete: (p: Provider) => void;
  /** called after a reorder is persisted, so the parent can refresh its list */
  onReordered?: () => void;
}

export function ProviderList({
  providers,
  activeId,
  onSwitch,
  onEdit,
  onDelete,
  onReordered,
}: Props) {
  // Local copy so drag reorders feel instant; we persist on drop. The parent
  // keeps its own list as the source of truth and re-renders us with the
  // post-persist order, which matches our optimistic local order.
  const reorder = useReorder(async (toIdx, fromIdx) => {
    try {
      await api.reorderProviders(fromIdx, toIdx);
      onReordered?.();
    } catch (e) {
      toast.error(`排序失败：${e}`);
    }
  });

  if (providers.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-6 py-16 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Server className="h-6 w-6" />
          </div>
          <h3 className="font-semibold">还没有供应商</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            点击右下角「+」，开始配置你的第一个 API。
          </p>
        </div>
      </div>
    );
  }

  // Apply the optimistic in-flight reorder on top of the prop list, so the UI
  // stays responsive during the drag and snaps to the persisted order after.
  const ordered =
    reorder.state.dragging !== null && reorder.state.over !== null
      ? move(providers, reorder.state.dragging, reorder.state.over)
      : providers;

  return (
    <div className="flex flex-col gap-2.5 overflow-y-auto p-4">
      {ordered.map((p, i) => (
        <ProviderCard
          key={p.id}
          provider={p}
          isActive={p.id === activeId}
          onSwitch={onSwitch}
          onEdit={onEdit}
          onDelete={onDelete}
          listIndex={i}
          onDragStart={reorder.start}
          isDragging={reorder.state.dragging === i}
          isDragOver={reorder.state.over === i && reorder.state.dragging !== i}
        />
      ))}
    </div>
  );
}
