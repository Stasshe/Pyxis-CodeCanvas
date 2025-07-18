import { Project } from "@/types/";
import type { Tab, FileItem } from "@/types";

// === File Operation Handler ===
// この関数は、ファイル操作（作成、更新、削除）を
// プロジェクトの状態に反映させるためのものです。
// NodeRuntime操作やGit操作からの呼び出しを想定しています。

type Params = {
  path: string;
  type: "file" | "folder" | "delete";
  content?: string;
  isNodeRuntime?: boolean;
  currentProject: Project | null;
  loadProject: ((project: Project) => Promise<void>) | null;
  saveFile?: (path: string, content: string) => Promise<void>;
  deleteFile?: (id: string) => Promise<void>;
  tabs: Tab[];
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  projectFiles: FileItem[];
  setGitRefreshTrigger: React.Dispatch<React.SetStateAction<number>>;
  setNodeRuntimeOperationInProgress: (v: boolean) => void;
  refreshProjectFiles?: () => Promise<void>;
};

export async function handleFileOperation({
  path,
  type,
  content,
  isNodeRuntime,
  currentProject,
  loadProject,
  saveFile,
  deleteFile,
  tabs,
  setTabs,
  activeTabId,
  setActiveTabId,
  projectFiles,
  setGitRefreshTrigger,
  setNodeRuntimeOperationInProgress,
  refreshProjectFiles,
}: Params) {
  console.log("=== onFileOperation called ===");
  console.log("path:", path);
  console.log("type:", type);
  console.log("content length:", content?.length || "N/A");
  console.log("isNodeRuntime:", isNodeRuntime);

  // NodeRuntime操作の場合はフラグを設定
  if (isNodeRuntime) {
    console.log("NodeRuntime operation detected, setting flag");
    setNodeRuntimeOperationInProgress(true);
  }

  // 「.」パスはプロジェクト更新通知のためのダミー操作
  // 実際のファイル作成は行わず、プロジェクトリロードのみ実行
  if (path === ".") {
    console.log(
      "Dummy project refresh operation detected, skipping file operations",
    );
    if (currentProject && loadProject) {
      console.log("Reloading project for refresh:", currentProject.name);
      await loadProject(currentProject);
      setGitRefreshTrigger((prev) => prev + 1);
    }
    return;
  }
  // Gitコマンドからのファイル操作をプロジェクトに反映
  if (currentProject) {
    console.log(
      "Processing real file operation for project:",
      currentProject.name,
    );

    // NodeRuntime操作の場合は、まずDBに保存してからタブを更新
    if (isNodeRuntime) {
      console.log("NodeRuntime operation: saving to DB first");

      // 該当ファイルがタブで開かれている場合、その内容を即座に更新
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const openTab = tabs.find((tab) => tab.path === normalizedPath);

      if (openTab && content !== undefined) {
        console.log("NodeRuntime: Immediately updating open tab content");
        setTabs((prevTabs) =>
          prevTabs.map((tab) => {
            if (tab.id === openTab.id) {
              return {
                ...tab,
                content: content,
                isDirty: false,
              };
            }
            return tab;
          }),
        );
      }

      // IndexedDBにも保存
      if (saveFile) {
        try {
          await saveFile(normalizedPath, content || "");
          console.log("NodeRuntime: File saved to IndexedDB successfully");
        } catch (error) {
          console.error("NodeRuntime: Failed to save to IndexedDB:", error);
        }
      }

      // Git状態を更新
      setGitRefreshTrigger((prev) => prev + 1);

      // NodeRuntime操作フラグをリセット
      setNodeRuntimeOperationInProgress(false);
      console.log("NodeRuntime operation completed");
      return;
    }

    // 通常のGit操作の場合
    console.log("Git operation: processing file operation", {
      path,
      type,
      contentLength: content?.length || 0,
    });

    // 削除操作の場合、IndexedDBからも削除
    if (type === "delete") {
      // 最新の projectFiles を取得してから削除判定
      if (refreshProjectFiles) {
        await refreshProjectFiles();
        console.log("Project files refreshed before file delete");
      }
      console.log("=== GIT DELETE OPERATION PROCESSING ===");
      console.log("Git delete operation: removing file from IndexedDB");
      console.log("Delete request path:", path);
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      console.log("Normalized path:", normalizedPath);
      console.log("Current projectFiles count:", projectFiles.length);
      console.log(
        "Available projectFiles paths:",
        projectFiles.map((f) => f.path),
      );
      const fileToDelete = projectFiles.find((f) => f.path === normalizedPath);
      console.log("File to delete found:", !!fileToDelete);
      if (fileToDelete) {
        console.log("File to delete details:", {
          id: fileToDelete.id,
          path: fileToDelete.path,
        });
      }

      if (fileToDelete && deleteFile) {
        try {
          console.log(
            "Attempting to delete file from IndexedDB:",
            fileToDelete.id,
          );
          await deleteFile(fileToDelete.id);
          console.log(
            "Successfully deleted file from IndexedDB:",
            normalizedPath,
          );
          // 削除後に必ず projectFiles をリフレッシュ
          if (refreshProjectFiles) {
            await refreshProjectFiles();
            console.log("Project files refreshed after file delete");
          }
        } catch (error) {
          console.error("Failed to delete file from IndexedDB:", error);
        }
      } else {
        console.log(
          "File not found in projectFiles or deleteFile function not available",
        );
        console.log("fileToDelete:", !!fileToDelete);
        console.log("deleteFile:", !!deleteFile);
      }

  // タブ閉じ処理はprojectFiles更新後のuseEffectで行う
    } else {
      // ファイル作成・更新の場合
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const openTab = tabs.find((tab) => tab.path === normalizedPath);

      if (openTab && content !== undefined) {
        console.log("Git operation: updating open tab content");
        setTabs((prevTabs) =>
          prevTabs.map((tab) => {
            if (tab.id === openTab.id) {
              return {
                ...tab,
                content: content,
                isDirty: false,
              };
            }
            return tab;
          }),
        );
      }

      // ファイルをIndexedDBに保存（作成・更新）
      if (content !== undefined && saveFile) {
        try {
          await saveFile(normalizedPath, content);
          console.log("Git operation: file saved to IndexedDB successfully");
        } catch (error) {
          console.error("Git operation: failed to save to IndexedDB:", error);
        }
      }
    }

    // Git状態とプロジェクトファイル状態を更新
    setGitRefreshTrigger((prev) => prev + 1);

    // プロジェクトファイル状態も即座に更新
    if (refreshProjectFiles) {
      console.log("Refreshing project files after Git operation");
      await refreshProjectFiles();
      console.log("Project files refreshed after Git operation");
    }

    console.log("Git operation completed");
  } else {
    console.log("No current project or loadProject function");
  }
}
