import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ClickUpService from "./ClickUpService.ts";

const task = {
  id: "abc",
  custom_id: "ENG-7",
  name: "Ship it",
  url: "https://app.clickup.com/t/abc",
  status: { status: "in progress" },
  assignees: [{ username: "ana" }],
  list: { id: "L1", name: "Sprint" },
};

/** A fake ClickUp where only `visibleTo` sees anything; the custom id lives in workspace W2. */
const setup = (visibleTo: string) => {
  const secrets = new Map<string, Uint8Array>();
  const seen: Array<string> = [];
  const layer = ClickUpService.layer.pipe(
    Layer.provide(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
        set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
        remove: (name) => Effect.sync(() => void secrets.delete(name)),
      }),
    ),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          const token = request.headers.authorization ?? "";
          const url = new URL(request.url);
          const path = url.pathname.replace("/api/v2", "");
          seen.push(`${token} ${request.method} ${path}${url.search}`);
          const route = (): Response => {
            if (token !== visibleTo)
              return Response.json({ err: "Team not authorized" }, { status: 401 });
            if (path === "/user") return Response.json({ user: { id: 1 } });
            if (path === "/team")
              return Response.json({
                teams: [
                  { id: "W1", members: [] },
                  {
                    id: "W2",
                    members: [{ user: { id: 2, username: "bo", email: "bo@acme.dev" } }],
                  },
                ],
              });
            if (path === "/team/W2/task")
              return Response.json({
                tasks: [task, { ...task, id: "def", custom_id: null, name: "Other" }],
                last_page: true,
              });
            if (path === "/team/W1/task") return Response.json({ tasks: [], last_page: true });
            if (path.endsWith("/comment") && request.method === "GET")
              return Response.json({
                comments: [{ comment_text: "hi", user: { username: "bo" } }],
              });
            if (path === "/task/ENG-7" && url.searchParams.get("team_id") !== "W2")
              return Response.json({ err: "Task not found" }, { status: 404 });
            if (path.startsWith("/task/") && request.method === "GET") return Response.json(task);
            if (path === "/list/L1")
              return Response.json({
                id: "L1",
                statuses: [{ status: "to do" }, { status: "done" }],
              });
            if (path === "/list/L1/task") return Response.json({ ...task, id: "new" });
            return new Response(null, { status: 200 });
          };
          return Effect.succeed(HttpClientResponse.fromWeb(request, route()));
        }),
      ),
    ),
  );
  return { layer, seen };
};

it.effect("reads a task with the first token that can see it", () => {
  const { layer, seen } = setup("second");
  return Effect.gen(function* () {
    const clickup = yield* ClickUpService.ClickUpService;
    yield* clickup.setTokens({ tokens: ["first", "second"] });
    const result = yield* clickup.getTask("abc");
    assert.strictEqual(result.status, "in progress");
    assert.strictEqual(result.listId, "L1");
    assert.deepStrictEqual(result.listStatuses, ["to do", "done"]);
    assert.deepStrictEqual(result.comments, [{ author: "bo", text: "hi", date: null }]);
    assert.deepStrictEqual(
      seen.filter((line) => line.includes("GET /task/abc?")).map((line) => line.split(" ")[0]),
      ["first", "second"],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("finds a custom task id by trying each workspace", () => {
  const { layer, seen } = setup("only");
  return Effect.gen(function* () {
    const clickup = yield* ClickUpService.ClickUpService;
    yield* clickup.setTokens({ tokens: ["only"] });
    const result = yield* clickup.getTask("ENG-7");
    assert.strictEqual(result.id, "abc");
    assert.deepStrictEqual(
      seen
        .filter((line) => line.includes("/task/ENG-7"))
        .map((line) => /team_id=(\w+)/.exec(line)?.[1]),
      ["W1", "W2"],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("resolves assignees and sends tag changes on update", () => {
  const { layer, seen } = setup("only");
  return Effect.gen(function* () {
    const clickup = yield* ClickUpService.ClickUpService;
    yield* clickup.setTokens({ tokens: ["only"] });
    yield* clickup.updateTask({
      taskId: "https://app.clickup.com/t/abc",
      addAssignees: ["BO@acme.dev", "me"],
      addTags: ["bug"],
      removeTags: ["needs triage"],
    });
    assert.includeMembers(seen, [
      "only PUT /task/abc",
      "only POST /task/abc/tag/bug",
      "only DELETE /task/abc/tag/needs%20triage",
    ]);
    const unknown = yield* Effect.flip(
      clickup.updateTask({ taskId: "abc", addAssignees: ["nobody"] }),
    );
    assert.strictEqual(unknown.message, 'No ClickUp member matches "nobody".');
  }).pipe(Effect.provide(layer));
});

it.effect("searches names across workspaces and creates subtasks in the parent's list", () => {
  const { layer, seen } = setup("only");
  return Effect.gen(function* () {
    const clickup = yield* ClickUpService.ClickUpService;
    yield* clickup.setTokens({ tokens: ["only"] });
    const found = yield* clickup.searchTasks({ query: "ship", assignedToMe: true });
    assert.deepStrictEqual(
      found.tasks.map((summary) => summary.id),
      ["abc"],
    );
    assert.isTrue(
      seen.some((line) => line.includes("/team/W2/task?") && line.includes("assignees%5B%5D=1")),
    );
    const created = yield* clickup.createTask({ name: "Follow-up", parentTaskId: "abc" });
    assert.strictEqual(created.listId, "L1");
    assert.isTrue(seen.includes("only POST /list/L1/task"));
  }).pipe(Effect.provide(layer));
});

it.effect("fails with a reason when no account is connected or none can see the task", () => {
  const { layer } = setup("nobody");
  return Effect.gen(function* () {
    const clickup = yield* ClickUpService.ClickUpService;
    const missing = yield* Effect.flip(clickup.getTask("abc"));
    assert.include(missing.message, "No ClickUp account is connected");
    yield* clickup.setTokens({ tokens: ["first"] });
    const hidden = yield* Effect.flip(clickup.addComment("abc", "hello"));
    assert.strictEqual(hidden.message, "ClickUp 401: Team not authorized");
    yield* clickup.setTokens({ tokens: [] });
    const cleared = yield* Effect.flip(clickup.getTask("abc"));
    assert.include(cleared.message, "No ClickUp account is connected");
  }).pipe(Effect.provide(layer));
});

it("parses task ids, custom ids, and task URLs", () => {
  assert.deepStrictEqual(ClickUpService.parseTaskRef("z8rp3fdcgm"), {
    id: "z8rp3fdcgm",
    teamId: undefined,
    custom: false,
  });
  assert.deepStrictEqual(ClickUpService.parseTaskRef("https://app.clickup.com/t/z8rp3fdcgm?x=1"), {
    id: "z8rp3fdcgm",
    teamId: undefined,
    custom: false,
  });
  assert.deepStrictEqual(ClickUpService.parseTaskRef("https://app.clickup.com/t/9012/ENG-7"), {
    id: "ENG-7",
    teamId: "9012",
    custom: true,
  });
});
