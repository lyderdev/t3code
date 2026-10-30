import { expect, it, vi } from "vite-plus/test";

import { reviewCommentContextRecord } from "../lib/composerContextRecords";
import type { ClickUpTask } from "./api";
import {
  buildClickUpTaskContext,
  mentionedClickUpTasks,
  setClickUpOpenTask,
  useClickUpOpenTaskStore,
} from "./clickupTaskMentions";

function task(id: string, name: string, status: string): ClickUpTask {
  return {
    id,
    name,
    url: `https://app.clickup.com/t/${id}`,
    status: { status, color: "#000" },
    priority: null,
    due_date: null,
    assignees: [],
  };
}

function message(...tasks: ReadonlyArray<ClickUpTask>) {
  return {
    context: {
      version: 1 as const,
      records: tasks.map((entry) => reviewCommentContextRecord(buildClickUpTaskContext(entry))),
    },
  };
}

it("lists each mentioned ClickUp task once, first mention first", () => {
  expect(
    mentionedClickUpTasks([
      { context: undefined },
      message(task("a1", "Fix login", "in progress")),
      message(task("b2", "Ship it", "to do"), task("a1", "Fix login", "done")),
    ]),
  ).toEqual([
    { id: "a1", name: "Fix login", status: "in progress" },
    { id: "b2", name: "Ship it", status: "to do" },
  ]);
});

it("keeps a separate open task per ClickUp panel", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
  setClickUpOpenTask("a1", "env-one:thread-one");
  setClickUpOpenTask("b2", "env-two:thread-two");
  expect(useClickUpOpenTaskStore.getState().byScope).toEqual({
    "env-one:thread-one": "a1",
    "env-two:thread-two": "b2",
  });

  setClickUpOpenTask(null, "env-one:thread-one");
  expect(useClickUpOpenTaskStore.getState().byScope).toEqual({ "env-two:thread-two": "b2" });
  expect(JSON.parse(store.get("ldcode:clickup:open-task") ?? "{}")).toEqual({
    "env-two:thread-two": "b2",
  });
});
