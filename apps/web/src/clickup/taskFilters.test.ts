import { expect, it, vi } from "vite-plus/test";

import type { ClickUpTask } from "./api";
import { EMPTY_TASK_FILTERS, taskMatchesFilters, UNASSIGNED_FILTER } from "./taskFilters";

function task(overrides: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: "t1",
    name: "Task",
    url: "https://app.clickup.com",
    status: { status: "in progress", color: "#4466ff" },
    priority: { priority: "1" },
    due_date: null,
    assignees: [{ id: 1, username: "Loi Do", initials: "LD", color: "#7b68ee" }],
    ...overrides,
  };
}

const filters = (patch: Partial<typeof EMPTY_TASK_FILTERS> = {}) => ({
  ...EMPTY_TASK_FILTERS,
  ...patch,
});

it("matches every task when no filters are set", () => {
  expect(taskMatchesFilters(task(), EMPTY_TASK_FILTERS)).toBe(true);
});

it("matches status, priority and tag by membership", () => {
  const subject = task({ tags: [{ name: "ship" }] });
  expect(taskMatchesFilters(subject, filters({ statuses: ["to do"] }))).toBe(false);
  expect(taskMatchesFilters(subject, filters({ statuses: ["in progress"] }))).toBe(true);
  expect(taskMatchesFilters(subject, filters({ priorities: ["2"] }))).toBe(false);
  expect(taskMatchesFilters(subject, filters({ tags: ["ui"] }))).toBe(false);
  expect(taskMatchesFilters(subject, filters({ tags: ["ship"] }))).toBe(true);
});

it("treats a null priority as the none option", () => {
  const subject = task({ priority: null });
  expect(taskMatchesFilters(subject, filters({ priorities: ["none"] }))).toBe(true);
  expect(taskMatchesFilters(subject, filters({ priorities: ["1"] }))).toBe(false);
});

it("matches assignees, including unassigned", () => {
  expect(taskMatchesFilters(task(), filters({ assignees: ["1"] }))).toBe(true);
  expect(taskMatchesFilters(task(), filters({ assignees: ["2"] }))).toBe(false);
  expect(taskMatchesFilters(task({ assignees: [] }), filters({ assignees: ["1"] }))).toBe(false);
  expect(
    taskMatchesFilters(task({ assignees: [] }), filters({ assignees: [UNASSIGNED_FILTER] })),
  ).toBe(true);
});

it("matches due date windows relative to the start of today", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T10:00:00"));
  try {
    const startOfToday = new Date("2026-01-15T00:00:00").getTime();
    const at = (offsetMs: number) => String(startOfToday + offsetMs);
    const day = 86_400_000;

    expect(taskMatchesFilters(task({ due_date: at(-day) }), filters({ due: "overdue" }))).toBe(
      true,
    );
    expect(taskMatchesFilters(task({ due_date: at(day) }), filters({ due: "overdue" }))).toBe(
      false,
    );
    expect(taskMatchesFilters(task({ due_date: at(1) }), filters({ due: "today" }))).toBe(true);
    expect(taskMatchesFilters(task({ due_date: at(-1) }), filters({ due: "today" }))).toBe(false);
    expect(taskMatchesFilters(task({ due_date: at(3 * day) }), filters({ due: "week" }))).toBe(
      true,
    );
    expect(taskMatchesFilters(task({ due_date: at(8 * day) }), filters({ due: "week" }))).toBe(
      false,
    );
    expect(taskMatchesFilters(task({ due_date: null }), filters({ due: "none" }))).toBe(true);
    expect(taskMatchesFilters(task({ due_date: null }), filters({ due: "week" }))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
