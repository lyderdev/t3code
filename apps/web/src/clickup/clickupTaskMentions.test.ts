import { expect, it } from "vite-plus/test";

import { reviewCommentContextRecord } from "../lib/composerContextRecords";
import type { ClickUpTask } from "./api";
import { buildClickUpTaskContext, mentionedClickUpTasks } from "./clickupTaskMentions";

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
