import type { ClickUpTask } from "./api";

export type ClickUpTaskThreadRef = { readonly environmentId: string; readonly threadId: string };

const TASK_THREADS_STORAGE_KEY = "t3code:clickup:task-threads";

// shortcut: links live in this browser only, so other clients do not see them; move to the thread record if that matters.
export function readTaskThreads(): Record<string, ReadonlyArray<ClickUpTaskThreadRef>> {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(TASK_THREADS_STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, ClickUpTaskThreadRef[]>)
      : {};
  } catch {
    return {};
  }
}

/** Records the tasks against a thread, keeping each task linked once per thread. */
export function linkTasksToThread(
  tasks: ReadonlyArray<ClickUpTask>,
  ref: ClickUpTaskThreadRef,
): Record<string, ReadonlyArray<ClickUpTaskThreadRef>> {
  const next = { ...readTaskThreads() };
  for (const task of tasks) {
    const refs = next[task.id] ?? [];
    const linked = refs.some(
      (entry) => entry.environmentId === ref.environmentId && entry.threadId === ref.threadId,
    );
    if (!linked) next[task.id] = [...refs, ref];
  }
  window.localStorage.setItem(TASK_THREADS_STORAGE_KEY, JSON.stringify(next));
  return next;
}
