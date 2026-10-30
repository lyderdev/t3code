import { OrchestratorMcpFailure, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ClickUpService from "../../../clickup/ClickUpService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ClickUpService.ClickUpService,
];

const ClickUpGetTaskTool = Tool.make("clickup_get_task", {
  description:
    "Read a ClickUp task: name, status, description, assignees, tags, list, and comments. Uses the ClickUp accounts the user connected in T3 Code.",
  parameters: ClickUpService.ClickUpTaskId,
  success: ClickUpService.ClickUpTask,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read a ClickUp task")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ClickUpSearchTasksTool = Tool.make("clickup_search_tasks", {
  description:
    "Find ClickUp tasks across the connected workspaces, most recently updated first. Filters combine. Returns at most 20; narrow the filters when `truncated`.",
  parameters: ClickUpService.ClickUpSearchInput,
  success: ClickUpService.ClickUpSearchResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Search ClickUp tasks")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ClickUpCreateTaskTool = Tool.make("clickup_create_task", {
  description:
    "Create a ClickUp task or subtask. A list id comes from `listId` in another task's result. Only create tasks the user asked for.",
  parameters: ClickUpService.ClickUpCreateInput,
  success: ClickUpService.ClickUpTask,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create a ClickUp task")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ClickUpUpdateTaskTool = Tool.make("clickup_update_task", {
  description:
    "Change a ClickUp task's status, name, description (markdown; replaces the whole description), assignees, or tags. Status must be one of the task's list statuses. Only change what the user asked for.",
  parameters: ClickUpService.ClickUpUpdateInput,
  success: ClickUpService.ClickUpTask,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Update a ClickUp task")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ClickUpCommentTool = Tool.make("clickup_add_comment", {
  description: "Post a comment on a ClickUp task, as the connected ClickUp user.",
  parameters: Schema.Struct({
    ...ClickUpService.ClickUpTaskId.fields,
    text: TrimmedNonEmptyString,
  }),
  success: Schema.Struct({ commentId: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Comment on a ClickUp task")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const ClickUpToolkit = Toolkit.make(
  ClickUpGetTaskTool,
  ClickUpSearchTasksTool,
  ClickUpCreateTaskTool,
  ClickUpUpdateTaskTool,
  ClickUpCommentTool,
);
