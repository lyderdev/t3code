import { expect, it } from "vite-plus/test";

import type { ClickUpTask } from "./api";
import { nestSubtasks } from "./subtasks";

const task = (id: string, parent: string | null = null): ClickUpTask => ({
  id,
  name: id,
  url: "https://app.clickup.com",
  status: { status: "to do", color: "#87909e" },
  priority: null,
  due_date: null,
  assignees: [],
  parent,
});

it("nests subtasks under shown parents and keeps orphans top-level", () => {
  const { roots, children } = nestSubtasks(
    [task("a"), task("a1", "a"), task("a1x", "a1"), task("orphan", "hidden")],
    "collapsed",
  );
  expect(roots.map((entry) => entry.id)).toEqual(["a", "orphan"]);
  expect(children.get("a")?.map((entry) => entry.id)).toEqual(["a1"]);
  expect(children.get("a1")?.map((entry) => entry.id)).toEqual(["a1x"]);
});

it("lists every task top-level when shown as separate tasks", () => {
  const { roots, children } = nestSubtasks([task("a"), task("a1", "a")], "separate");
  expect(roots).toHaveLength(2);
  expect(children.size).toBe(0);
});
