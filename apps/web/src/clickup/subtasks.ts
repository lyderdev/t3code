import type { ClickUpTask } from "./api";

export type SubtaskMode = "collapsed" | "expanded" | "separate";

export const SUBTASK_MODE_OPTIONS = [
  ["collapsed", "Collapse all"],
  ["expanded", "Expand all"],
  ["separate", "As separate tasks"],
] as const;

/** Nests subtasks under their parent like ClickUp; a subtask whose parent is not shown stays top-level. */
export function nestSubtasks(
  tasks: ReadonlyArray<ClickUpTask>,
  mode: SubtaskMode,
): { roots: Array<ClickUpTask>; children: Map<string, Array<ClickUpTask>> } {
  const shown = new Set(tasks.map((task) => task.id));
  const roots: Array<ClickUpTask> = [];
  const children = new Map<string, Array<ClickUpTask>>();
  for (const task of tasks) {
    const parent = mode === "separate" ? null : task.parent;
    if (parent && shown.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), task]);
    } else {
      roots.push(task);
    }
  }
  return { roots, children };
}
