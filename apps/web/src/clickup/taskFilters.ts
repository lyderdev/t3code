import type { ClickUpTask } from "./api";

/** ClickUp's task filters, limited to fields the list endpoint returns. */
export type TaskFilters = {
  readonly statuses: ReadonlyArray<string>;
  readonly assignees: ReadonlyArray<string>;
  readonly priorities: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly due: DueFilter;
};

export type DueFilter = "overdue" | "today" | "week" | "none" | null;

export const EMPTY_TASK_FILTERS: TaskFilters = {
  statuses: [],
  assignees: [],
  priorities: [],
  tags: [],
  due: null,
};

export const DUE_FILTER_OPTIONS = [
  ["overdue", "Overdue"],
  ["today", "Due today"],
  ["week", "Due this week"],
  ["none", "No due date"],
] as const;

export const UNASSIGNED_FILTER = "unassigned";

function matchesDueFilter(dueDate: string | null, due: DueFilter): boolean {
  if (due === null) return true;
  if (due === "none") return dueDate === null;
  if (dueDate === null) return false;
  const value = Number(dueDate);
  if (!Number.isFinite(value)) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (due === "overdue") return value < startOfToday;
  if (due === "today") return value >= startOfToday && value < startOfToday + 86_400_000;
  return value >= startOfToday && value < startOfToday + 7 * 86_400_000;
}

export function taskMatchesFilters(task: ClickUpTask, filters: TaskFilters): boolean {
  return (
    (filters.statuses.length === 0 || filters.statuses.includes(task.status.status)) &&
    (filters.assignees.length === 0 ||
      task.assignees.some((assignee) => filters.assignees.includes(String(assignee.id))) ||
      (task.assignees.length === 0 && filters.assignees.includes(UNASSIGNED_FILTER))) &&
    (filters.priorities.length === 0 ||
      filters.priorities.includes(task.priority?.priority ?? "none")) &&
    (filters.tags.length === 0 ||
      (task.tags ?? []).some((tag) => filters.tags.includes(tag.name))) &&
    matchesDueFilter(task.due_date, filters.due)
  );
}

export function activeFilterCount(filters: TaskFilters): number {
  return (
    filters.statuses.length +
    filters.assignees.length +
    filters.priorities.length +
    filters.tags.length +
    (filters.due === null ? 0 : 1)
  );
}
