import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ClickUpService from "../../../clickup/ClickUpService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ClickUpToolkit } from "./tools.ts";

const toFailure = Effect.mapError(
  (error: { readonly message: string }) =>
    new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
);

const handlers = {
  clickup_get_task: McpToolAccess.readsAsCaller(({ taskId }) =>
    Effect.gen(function* () {
      const clickup = yield* ClickUpService.ClickUpService;
      return yield* clickup.getTask(taskId).pipe(toFailure);
    }),
  ),
  clickup_search_tasks: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const clickup = yield* ClickUpService.ClickUpService;
      return yield* clickup.searchTasks(input).pipe(toFailure);
    }),
  ),
  clickup_create_task: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const clickup = yield* ClickUpService.ClickUpService;
      return yield* clickup.createTask(input).pipe(toFailure);
    }),
  ),
  clickup_update_task: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { taskId: _, ...changes } = input;
      if (Object.values(changes).every((value) => value === undefined))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass at least one change.",
        });
      const clickup = yield* ClickUpService.ClickUpService;
      return yield* clickup.updateTask(input).pipe(toFailure);
    }),
  ),
  clickup_add_comment: McpToolAccess.actsAsCaller(({ taskId, text }) =>
    Effect.gen(function* () {
      const clickup = yield* ClickUpService.ClickUpService;
      return yield* clickup.addComment(taskId, text).pipe(toFailure);
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof ClickUpToolkit.tools>;

export const layer = McpToolAccess.toLayer(ClickUpToolkit, handlers);
