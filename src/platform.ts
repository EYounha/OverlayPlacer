/**
 * 웹/데스크톱(Tauri) 겸용 입출력 계층.
 *
 * WebView2에서는 <a download>와 navigator.clipboard가 보장되지 않는다 —
 * 다운로드 핸들러가 없고 클립보드 읽기 권한 프롬프트가 뜨지 않는 환경이
 * 있다. 데스크톱에서는 Tauri 플러그인(dialog/fs/clipboard-manager)을 쓰고,
 * 브라우저에서는 기존 웹 API로 동작한다.
 */

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type SaveResult = "saved" | "cancelled" | "web";

/** 파일 저장. 데스크톱은 저장 대화상자, 웹은 다운로드. */
export async function saveTextFile(defaultName: string, text: string): Promise<SaveResult> {
  if (isTauri) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (!path) return "cancelled";
      await writeTextFile(path, text);
      return "saved";
    } catch {
      // 플러그인 경로가 막히면 웹 방식으로 폴백
    }
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "web";
}

/** 파일 열기. null = 취소 (웹 취소는 콜백이 오지 않아 감지 불가). */
export async function openTextFile(): Promise<string | null> {
  if (isTauri) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (typeof path !== "string") return null;
      return await readTextFile(path);
    } catch {
      // 폴백
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      file.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}

export async function readClipboardText(): Promise<string | null> {
  if (isTauri) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    } catch {
      // 폴백
    }
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (isTauri) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {
      // 폴백
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
