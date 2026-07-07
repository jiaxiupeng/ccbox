import { useCallback, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Update info exposed to the UI. */
export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

/** Result of a manual or silent check. */
export type CheckResult =
  | { status: "available"; info: UpdateInfo }
  | { status: "upToDate" }
  | { status: "error"; message: string };

type Silent = { silent: boolean };

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Wraps the Tauri updater plugin.
 *
 * - `checkForUpdates({ silent })` queries the configured endpoint. In silent
 *   mode errors are swallowed (only sets state); in manual mode they throw so
 *   the caller can toast them.
 * - `downloadAndInstall()` downloads the signed bundle with progress and
 *   relaunches the app on completion.
 * - State `hasUpdate` / `updateInfo` drives the header badge; `checking` /
 *   `downloading` / `progress` drive the dialog UI.
 */
export function useUpdateChecker() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  // Throttle silent checks so a quick app restart doesn't re-query GitHub.
  // Track whether the last check actually succeeded: if it failed (network /
  // 404 / etc.), the next check must hit the network again regardless of time.
  const lastCheckRef = useRef(0);
  const lastCheckOkRef = useRef(false);
  const updateRef = useRef<Update | null>(null);

  const checkForUpdates = useCallback(
    async ({ silent }: Silent): Promise<CheckResult> => {
      // Throttle: silent checks run at most once per hour — but only if the
      // previous check was successful. A failed startup check must not poison
      // a subsequent manual check with a stale "upToDate" result.
      if (silent && lastCheckOkRef.current && Date.now() - lastCheckRef.current < ONE_HOUR) {
        return { status: "upToDate" };
      }
      setChecking(true);
      try {
        const upd = await check();
        lastCheckRef.current = Date.now();
        lastCheckOkRef.current = true;
        if (upd) {
          updateRef.current = upd;
          const info: UpdateInfo = {
            version: upd.version,
            date: upd.date,
            body: upd.body,
          };
          setUpdateInfo(info);
          setHasUpdate(true);
          return { status: "available", info };
        }
        // No update: clear any stale badge.
        updateRef.current = null;
        setHasUpdate(false);
        setUpdateInfo(null);
        return { status: "upToDate" };
      } catch (e) {
        lastCheckOkRef.current = false;
        const message = String(e);
        // Both silent and manual failures return the error; the caller decides
        // whether to toast (App.tsx toasts on manual, swallows on silent).
        return { status: "error", message };
      } finally {
        setChecking(false);
      }
    },
    [],
  );

  const downloadAndInstall = useCallback(async () => {
    const upd = updateRef.current ?? (await check());
    if (!upd) throw new Error("没有可用的更新");
    setDownloading(true);
    setProgress(0);
    try {
      // onEvent fires with chunk length + content length for progress reporting.
      let total = 0;
      let downloaded = 0;
      await upd.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) {
              setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });
      // Installation completes; relaunch into the new version.
      await relaunch();
    } finally {
      setDownloading(false);
    }
  }, []);

  return {
    hasUpdate,
    updateInfo,
    checking,
    downloading,
    progress,
    checkForUpdates,
    downloadAndInstall,
  };
}
