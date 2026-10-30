import {
  ClickUpError,
  type ClickUpSetTokensInput,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

const API_BASE = "https://api.clickup.com/api/v2";
const SECRET_NAME = "clickup-tokens";
const Tokens = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeTokens = Schema.decodeUnknownOption(Tokens);
const encodeTokens = Schema.encodeSync(Tokens);
const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.Struct({ err: Schema.optional(Schema.String), error: Schema.optional(Schema.String) }),
);
/** ClickUp answers these when a token can't see the thing, so another token may. */
const NOT_VISIBLE = new Set([401, 403, 404]);
const SEARCH_LIMIT = 20;

const TaskRef = TrimmedNonEmptyString.annotate({
  description:
    "ClickUp task id, custom task id such as ENG-123, or the task's app.clickup.com URL.",
});
const Members = Schema.Array(TrimmedNonEmptyString).annotate({
  description: 'ClickUp usernames or emails; "me" is the connected user.',
});
const Tags = Schema.Array(TrimmedNonEmptyString);

export const ClickUpSearchInput = Schema.Struct({
  query: Schema.optional(TrimmedNonEmptyString).annotate({
    description: "Text the task name or id contains.",
  }),
  assignedToMe: Schema.optional(Schema.Boolean),
  statuses: Schema.optional(Tags),
  tags: Schema.optional(Tags),
  listId: Schema.optional(TrimmedNonEmptyString),
  includeClosed: Schema.optional(Schema.Boolean),
});
export type ClickUpSearchInput = typeof ClickUpSearchInput.Type;

export const ClickUpCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  listId: Schema.optional(TrimmedNonEmptyString).annotate({
    description: "List to create in. Optional with parentTaskId, which defaults to its list.",
  }),
  parentTaskId: Schema.optional(TaskRef).annotate({ description: "Creates a subtask of it." }),
  description: Schema.optional(Schema.String),
  status: Schema.optional(TrimmedNonEmptyString),
  assignees: Schema.optional(Members),
  tags: Schema.optional(Tags),
});
export type ClickUpCreateInput = typeof ClickUpCreateInput.Type;

export const ClickUpUpdateInput = Schema.Struct({
  taskId: TaskRef,
  status: Schema.optional(TrimmedNonEmptyString),
  name: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  addAssignees: Schema.optional(Members),
  removeAssignees: Schema.optional(Members),
  addTags: Schema.optional(Tags),
  removeTags: Schema.optional(Tags),
});
export type ClickUpUpdateInput = typeof ClickUpUpdateInput.Type;

export const ClickUpTaskId = Schema.Struct({ taskId: TaskRef });

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));
const RawTask = Schema.Struct({
  id: Schema.String,
  custom_id: OptionalText,
  name: Schema.String,
  url: Schema.String,
  status: Schema.Struct({ status: Schema.String }),
  priority: Schema.optional(Schema.NullOr(Schema.Struct({ priority: OptionalText }))),
  due_date: OptionalText,
  markdown_description: OptionalText,
  description: OptionalText,
  assignees: Schema.optional(Schema.Array(Schema.Struct({ username: OptionalText }))),
  tags: Schema.optional(Schema.Array(Schema.Struct({ name: OptionalText }))),
  list: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, name: OptionalText }))),
  parent: OptionalText,
});
type RawTask = typeof RawTask.Type;
const RawTasks = Schema.Struct({
  tasks: Schema.Array(RawTask),
  last_page: Schema.optional(Schema.Boolean),
});
const RawComments = Schema.Struct({
  comments: Schema.Array(
    Schema.Struct({
      comment_text: Schema.String,
      date: Schema.optional(Schema.String),
      user: Schema.optional(Schema.NullOr(Schema.Struct({ username: OptionalText }))),
    }),
  ),
});
const RawComment = Schema.Struct({ id: Schema.Union([Schema.String, Schema.Number]) });
const RawUser = Schema.Struct({ user: Schema.Struct({ id: Schema.Number }) });
const RawMember = Schema.Struct({
  id: Schema.Number,
  username: OptionalText,
  email: OptionalText,
});
const RawTeams = Schema.Struct({
  teams: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      members: Schema.optional(Schema.Array(Schema.Struct({ user: RawMember }))),
    }),
  ),
});
const RawList = Schema.Struct({
  id: Schema.String,
  statuses: Schema.optional(Schema.Array(Schema.Struct({ status: Schema.String }))),
});

const Nullable = Schema.NullOr(Schema.String);
export const ClickUpTaskSummary = Schema.Struct({
  id: Schema.String,
  customId: Nullable,
  name: Schema.String,
  url: Schema.String,
  status: Schema.String,
  assignees: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  list: Nullable,
  listId: Nullable,
  parent: Nullable,
});
export const ClickUpTask = Schema.Struct({
  ...ClickUpTaskSummary.fields,
  priority: Nullable,
  dueDate: Nullable,
  description: Schema.String,
  listStatuses: Schema.Array(Schema.String).annotate({
    description: "Statuses this task's list allows.",
  }),
  comments: Schema.Array(Schema.Struct({ author: Nullable, text: Schema.String, date: Nullable })),
});
export type ClickUpTask = typeof ClickUpTask.Type;
export const ClickUpSearchResult = Schema.Struct({
  tasks: Schema.Array(ClickUpTaskSummary),
  truncated: Schema.Boolean,
});
export type ClickUpSearchResult = typeof ClickUpSearchResult.Type;

export class ClickUpService extends Context.Service<
  ClickUpService,
  {
    readonly setTokens: (input: ClickUpSetTokensInput) => Effect.Effect<void, ClickUpError>;
    readonly getTask: (taskId: string) => Effect.Effect<ClickUpTask, ClickUpError>;
    readonly searchTasks: (
      input: ClickUpSearchInput,
    ) => Effect.Effect<ClickUpSearchResult, ClickUpError>;
    readonly createTask: (input: ClickUpCreateInput) => Effect.Effect<ClickUpTask, ClickUpError>;
    readonly updateTask: (input: ClickUpUpdateInput) => Effect.Effect<ClickUpTask, ClickUpError>;
    readonly addComment: (
      taskId: string,
      text: string,
    ) => Effect.Effect<{ readonly commentId: string }, ClickUpError>;
  }
>()("t3/clickup/ClickUpService") {}

const summarize = (task: RawTask) => ({
  id: task.id,
  customId: task.custom_id ?? null,
  name: task.name,
  url: task.url,
  status: task.status.status,
  assignees: (task.assignees ?? []).flatMap((assignee) => assignee.username ?? []),
  tags: (task.tags ?? []).flatMap((tag) => tag.name ?? []),
  list: task.list?.name ?? null,
  listId: task.list?.id ?? null,
  parent: task.parent ?? null,
});

const detail = (
  task: RawTask,
  comments: (typeof RawComments.Type)["comments"],
  listStatuses: ReadonlyArray<string>,
): ClickUpTask => ({
  ...summarize(task),
  priority: task.priority?.priority ?? null,
  dueDate: task.due_date ?? null,
  description: task.markdown_description ?? task.description ?? "",
  listStatuses,
  comments: comments.map((comment) => ({
    author: comment.user?.username ?? null,
    text: comment.comment_text,
    date: comment.date ?? null,
  })),
});

/** Accepts an id, a custom id, or a task URL; custom-id URLs carry their workspace id. */
export const parseTaskRef = (ref: string) => {
  const path = /app\.clickup\.com\/t\/([^?#]+)/.exec(ref)?.[1]?.split("/").filter(Boolean);
  const [teamId, id] = path?.length === 2 ? path : [undefined, path?.[0] ?? ref];
  return { id: id ?? ref, teamId, custom: (id ?? ref).includes("-") };
};

const failed = (message: string) => new ClickUpError({ message });

const make = Effect.gen(function* () {
  const store = yield* ServerSecretStore.ServerSecretStore;
  const client = yield* HttpClient.HttpClient;

  const readTokens = Effect.suspend(() => store.get(SECRET_NAME)).pipe(
    Effect.map(Option.flatMap((bytes) => decodeTokens(new TextDecoder().decode(bytes)))),
    Effect.map(Option.getOrElse((): ReadonlyArray<string> => [])),
    Effect.mapError(() => failed("Could not read the ClickUp tokens.")),
    Effect.filterOrFail(
      (tokens) => tokens.length > 0,
      () =>
        failed(
          "No ClickUp account is connected to this environment. Ask the user to connect one on the ClickUp page.",
        ),
    ),
  );

  const send = Effect.fn("ClickUpService.send")(function* (
    token: string,
    method: "GET" | "PUT" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ) {
    const base = HttpClientRequest.make(method)(`${API_BASE}${path}`).pipe(
      HttpClientRequest.setHeader("Authorization", token),
    );
    const response = yield* client
      .execute(body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, body))
      .pipe(
        Effect.timeout("20 seconds"),
        Effect.mapError(() => failed("Could not reach ClickUp.")),
      );
    const json = yield* response.json.pipe(Effect.orElseSucceed(() => null));
    const error = Option.getOrUndefined(decodeErrorBody(json));
    return {
      status: response.status,
      json,
      error: `ClickUp ${response.status}: ${error?.err ?? error?.error ?? "request failed"}`,
    };
  });

  const decode = <A>(schema: Schema.Decoder<A>, json: unknown) =>
    Schema.decodeEffect(schema)(json).pipe(
      Effect.mapError(() => failed("ClickUp answered in an unexpected shape.")),
    );

  /** Fails unless ClickUp answered 2xx. */
  const call = Effect.fn("ClickUpService.call")(function* <A>(
    schema: Schema.Decoder<A>,
    token: string,
    method: "GET" | "PUT" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ) {
    const response = yield* send(token, method, path, body);
    if (response.status < 200 || response.status >= 300) return yield* failed(response.error);
    return yield* decode(schema, response.json);
  });

  // shortcut: cached for the server's lifetime, so workspaces or members added later need a restart.
  const accounts = new Map<
    string,
    {
      readonly userId: number;
      readonly workspaceIds: ReadonlyArray<string>;
      readonly members: ReadonlyArray<typeof RawMember.Type>;
    }
  >();
  const account = Effect.fn("ClickUpService.account")(function* (token: string) {
    const cached = accounts.get(token);
    if (cached !== undefined) return cached;
    const [user, teams] = yield* Effect.all(
      [call(RawUser, token, "GET", "/user"), call(RawTeams, token, "GET", "/team")],
      { concurrency: 2 },
    );
    const value = {
      userId: user.user.id,
      workspaceIds: teams.teams.map((team) => team.id),
      members: teams.teams.flatMap((team) => (team.members ?? []).map((member) => member.user)),
    };
    accounts.set(token, value);
    return value;
  });

  // Threads can use any connected account, so a task one token can't see is tried with the next.
  const locate = Effect.fn("ClickUpService.locate")(function* (ref: string) {
    const { id, teamId, custom } = parseTaskRef(ref);
    let lastError = `ClickUp task ${ref} was not found.`;
    for (const token of yield* readTokens) {
      const teams = !custom
        ? [undefined]
        : teamId !== undefined
          ? [teamId]
          : (yield* account(token)).workspaceIds;
      for (const team of teams) {
        const query = team === undefined ? "" : `custom_task_ids=true&team_id=${team}&`;
        const response = yield* send(
          token,
          "GET",
          `/task/${encodeURIComponent(id)}?${query}include_markdown_description=true`,
        );
        if (response.status >= 200 && response.status < 300) {
          return { token, task: yield* decode(RawTask, response.json) };
        }
        lastError = response.error;
        if (!NOT_VISIBLE.has(response.status)) return yield* failed(lastError);
      }
    }
    return yield* failed(lastError);
  });

  const memberIds = Effect.fn("ClickUpService.memberIds")(function* (
    token: string,
    names: ReadonlyArray<string> | undefined,
  ) {
    if (names === undefined || names.length === 0) return [];
    const { userId, members } = yield* account(token);
    const ids: Array<number> = [];
    for (const name of names) {
      const wanted = name.toLowerCase();
      const match =
        wanted === "me"
          ? userId
          : members.find(
              (member) =>
                member.username?.toLowerCase() === wanted || member.email?.toLowerCase() === wanted,
            )?.id;
      if (match === undefined) return yield* failed(`No ClickUp member matches "${name}".`);
      ids.push(match);
    }
    return ids;
  });

  const detailOf = Effect.fn("ClickUpService.detailOf")(function* (token: string, task: RawTask) {
    const listId = task.list?.id;
    const [comments, statuses] = yield* Effect.all(
      [
        call(RawComments, token, "GET", `/task/${encodeURIComponent(task.id)}/comment`),
        listId === undefined
          ? Effect.succeed([])
          : call(RawList, token, "GET", `/list/${encodeURIComponent(listId)}`).pipe(
              Effect.map((list) => (list.statuses ?? []).map((entry) => entry.status)),
              // Statuses only guide the agent; a list it can't read shouldn't fail the read.
              Effect.orElseSucceed((): ReadonlyArray<string> => []),
            ),
      ],
      { concurrency: 2 },
    );
    return detail(task, comments.comments, statuses);
  });
  const refreshed = (token: string, taskId: string) =>
    call(
      RawTask,
      token,
      "GET",
      `/task/${encodeURIComponent(taskId)}?include_markdown_description=true`,
    ).pipe(Effect.flatMap((task) => detailOf(token, task)));

  return ClickUpService.of({
    setTokens: Effect.fn("ClickUpService.setTokens")(function* (input) {
      accounts.clear();
      const write =
        input.tokens.length === 0
          ? store.remove(SECRET_NAME)
          : store.set(SECRET_NAME, new TextEncoder().encode(encodeTokens(input.tokens)));
      yield* write.pipe(Effect.mapError(() => failed("Could not store the ClickUp tokens.")));
    }),
    getTask: Effect.fn("ClickUpService.getTask")(function* (ref) {
      const { token, task } = yield* locate(ref);
      return yield* detailOf(token, task);
    }),
    searchTasks: Effect.fn("ClickUpService.searchTasks")(function* (input) {
      const query = input.query?.toLowerCase();
      // shortcut: ClickUp's v2 API has no text search, so names are matched over the 5 most
      // recently updated pages (500 tasks) per workspace; use v3 search if that misses real tasks.
      const pages = query === undefined ? 1 : 5;
      const found = new Map<string, RawTask>();
      let truncated = false;
      let lastError: string | undefined;
      let searched = false;
      for (const token of yield* readTokens) {
        const { userId, workspaceIds } = yield* account(token);
        for (const workspaceId of workspaceIds) {
          for (let page = 0; page < pages && found.size <= SEARCH_LIMIT; page++) {
            const params = new URLSearchParams({
              page: String(page),
              order_by: "updated",
              subtasks: "true",
              include_closed: String(input.includeClosed ?? false),
            });
            if (input.assignedToMe) params.append("assignees[]", String(userId));
            for (const status of input.statuses ?? []) params.append("statuses[]", status);
            for (const tag of input.tags ?? []) params.append("tags[]", tag);
            if (input.listId !== undefined) params.append("list_ids[]", input.listId);
            const response = yield* send(token, "GET", `/team/${workspaceId}/task?${params}`);
            if (response.status < 200 || response.status >= 300) {
              lastError = response.error;
              break;
            }
            searched = true;
            const body = yield* decode(RawTasks, response.json);
            for (const task of body.tasks) {
              const matches =
                query === undefined ||
                task.name.toLowerCase().includes(query) ||
                task.id.toLowerCase() === query ||
                task.custom_id?.toLowerCase() === query;
              if (matches) found.set(task.id, task);
            }
            if (body.last_page !== false || body.tasks.length === 0) break;
            if (page === pages - 1) truncated = true;
          }
        }
      }
      if (!searched && lastError !== undefined) return yield* failed(lastError);
      const tasks = [...found.values()];
      return {
        tasks: tasks.slice(0, SEARCH_LIMIT).map(summarize),
        truncated: truncated || tasks.length > SEARCH_LIMIT,
      };
    }),
    createTask: Effect.fn("ClickUpService.createTask")(function* (input) {
      const parent =
        input.parentTaskId === undefined ? undefined : yield* locate(input.parentTaskId);
      const listId = input.listId ?? parent?.task.list?.id;
      if (listId === undefined) return yield* failed("Pass listId or parentTaskId.");
      let token = parent?.token;
      if (token === undefined) {
        for (const candidate of yield* readTokens) {
          const response = yield* send(candidate, "GET", `/list/${encodeURIComponent(listId)}`);
          if (response.status >= 200 && response.status < 300) {
            token = candidate;
            break;
          }
          if (!NOT_VISIBLE.has(response.status)) return yield* failed(response.error);
        }
      }
      if (token === undefined) return yield* failed(`ClickUp list ${listId} was not found.`);
      const assignees = yield* memberIds(token, input.assignees);
      const created = yield* call(
        RawTask,
        token,
        "POST",
        `/list/${encodeURIComponent(listId)}/task`,
        {
          name: input.name,
          ...(input.description === undefined ? {} : { markdown_content: input.description }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(assignees.length === 0 ? {} : { assignees }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
          ...(parent === undefined ? {} : { parent: parent.task.id }),
        },
      );
      return yield* refreshed(token, created.id);
    }),
    updateTask: Effect.fn("ClickUpService.updateTask")(function* (input) {
      const { token, task } = yield* locate(input.taskId);
      const path = `/task/${encodeURIComponent(task.id)}`;
      const add = yield* memberIds(token, input.addAssignees);
      const rem = yield* memberIds(token, input.removeAssignees);
      const body = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.description === undefined ? {} : { markdown_content: input.description }),
        ...(add.length === 0 && rem.length === 0 ? {} : { assignees: { add, rem } }),
      };
      if (Object.keys(body).length > 0) yield* call(Schema.Unknown, token, "PUT", path, body);
      for (const tag of input.addTags ?? []) {
        yield* call(Schema.Unknown, token, "POST", `${path}/tag/${encodeURIComponent(tag)}`);
      }
      for (const tag of input.removeTags ?? []) {
        yield* call(Schema.Unknown, token, "DELETE", `${path}/tag/${encodeURIComponent(tag)}`);
      }
      return yield* refreshed(token, task.id);
    }),
    addComment: Effect.fn("ClickUpService.addComment")(function* (ref, text) {
      const { token, task } = yield* locate(ref);
      const comment = yield* call(
        RawComment,
        token,
        "POST",
        `/task/${encodeURIComponent(task.id)}/comment`,
        { comment_text: text, notify_all: false },
      );
      return { commentId: String(comment.id) };
    }),
  });
});

export const layer = Layer.effect(ClickUpService, make);
