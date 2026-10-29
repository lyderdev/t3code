const API_BASE = "https://api.clickup.com/api/v2";
// Local-first app: the personal API token stays in this browser, never in server state.
const TOKEN_STORAGE_KEY = "ldcode:clickup:token";

export type ClickUpWorkspace = {
  readonly id: string;
  readonly name: string;
};

export type ClickUpSpace = {
  readonly id: string;
  readonly name: string;
};

export type ClickUpList = {
  readonly id: string;
  readonly name: string;
  readonly spaceId: string;
};

export type ClickUpListStatus = {
  readonly status: string;
  readonly color: string;
  readonly orderindex: number;
};

export type ClickUpTask = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly status: { readonly status: string; readonly color: string };
  readonly priority: { readonly priority: string } | null;
  readonly due_date: string | null;
  readonly assignees: ReadonlyArray<{
    readonly id: number;
    readonly username: string;
    readonly initials: string;
    readonly color: string;
  }>;
};

export type ClickUpIdentity = {
  readonly id: number;
  readonly username: string;
  readonly email: string;
};

class ClickUpApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ClickUpApiError";
  }
}

export type ClickUpAccount = {
  readonly token: string;
  readonly email: string;
  readonly workspaceId?: string;
  /** What the token reaches, so tokens for one email stay distinguishable. */
  readonly workspaceLabel?: string;
};

const ACCOUNTS_STORAGE_KEY = "ldcode:clickup:accounts";

/** Saved accounts, active one first. */
export function readClickUpAccounts(): ReadonlyArray<ClickUpAccount> {
  if (typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
  try {
    const parsed: unknown = stored === null ? null : JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is ClickUpAccount =>
          typeof entry?.token === "string" && typeof entry?.email === "string",
      );
    }
  } catch {}
  // Single-token storage from before multiple accounts; its email fills in on next connect.
  const legacy = window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim();
  return legacy ? [{ token: legacy, email: "" }] : [];
}

function writeClickUpAccounts(accounts: ReadonlyArray<ClickUpAccount>): void {
  window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function readClickUpToken(): string | null {
  return readClickUpAccounts()[0]?.token ?? null;
}

/** Adds or updates the account and makes it the active one. */
export function saveClickUpAccount(account: ClickUpAccount): void {
  writeClickUpAccounts([
    account,
    ...readClickUpAccounts().filter((entry) => entry.token !== account.token),
  ]);
}

export function removeClickUpAccount(token: string): void {
  writeClickUpAccounts(readClickUpAccounts().filter((entry) => entry.token !== token));
  invalidateClickUpCache(`${token}\n`);
}

const LAST_LIST_STORAGE_KEY = "ldcode:clickup:last-list";

export function readLastClickUpList(): { spaceId: string; listId: string } | null {
  if (typeof window === "undefined") return null;
  const [spaceId, listId] = (window.sessionStorage.getItem(LAST_LIST_STORAGE_KEY) ?? "").split(
    "\n",
  );
  return spaceId && listId ? { spaceId, listId } : null;
}

export function saveLastClickUpList(list: ClickUpList): void {
  window.sessionStorage.setItem(LAST_LIST_STORAGE_KEY, `${list.spaceId}\n${list.id}`);
}

const CACHE_MS = 5 * 60_000;
const readCache = new Map<string, { readonly at: number; readonly response: Promise<unknown> }>();

/** Drops cached reads so the next load goes to ClickUp; with a path, only reads containing it. */
export function invalidateClickUpCache(pathPart?: string): void {
  for (const key of readCache.keys()) {
    if (pathPart === undefined || key.includes(pathPart)) readCache.delete(key);
  }
}

// Reads are cached per token so the page reopens instantly; writes clear task reads.
function clickup<T>(
  token: string,
  path: string,
  init?: { readonly method: string; readonly body: unknown },
): Promise<T> {
  if (init !== undefined) {
    invalidateClickUpCache("/task");
    return request<T>(token, path, init);
  }
  const key = `${token}\n${path}`;
  const cached = readCache.get(key);
  if (cached !== undefined && Date.now() - cached.at < CACHE_MS)
    return cached.response as Promise<T>;
  const response = request<T>(token, path);
  readCache.set(key, { at: Date.now(), response });
  response.catch(() => {
    if (readCache.get(key)?.response === response) readCache.delete(key);
  });
  return response;
}

async function request<T>(
  token: string,
  path: string,
  init?: { readonly method: string; readonly body: unknown },
): Promise<T> {
  const response = await fetch(
    `${API_BASE}${path}`,
    init === undefined
      ? { headers: { Authorization: token } }
      : {
          method: init.method,
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: JSON.stringify(init.body),
        },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      err?: string;
      error?: string;
    } | null;
    throw new ClickUpApiError(
      response.status,
      body?.err ?? body?.error ?? `ClickUp request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

export async function fetchIdentity(token: string): Promise<ClickUpIdentity> {
  const body = await clickup<{ user: ClickUpIdentity }>(token, "/user");
  return body.user;
}

export async function fetchWorkspaces(token: string): Promise<ReadonlyArray<ClickUpWorkspace>> {
  const body = await clickup<{ teams: ReadonlyArray<ClickUpWorkspace> }>(token, "/team");
  return body.teams;
}

export async function fetchSpaces(
  token: string,
  workspaceId: string,
): Promise<ReadonlyArray<ClickUpSpace>> {
  const body = await clickup<{ spaces: ReadonlyArray<ClickUpSpace> }>(
    token,
    `/team/${workspaceId}/space?archived=false`,
  );
  return body.spaces;
}

export async function fetchLists(
  token: string,
  spaceId: string,
): Promise<ReadonlyArray<ClickUpList>> {
  const [folderless, folders] = await Promise.all([
    clickup<{ lists: ReadonlyArray<{ id: string; name: string }> }>(
      token,
      `/space/${spaceId}/list?archived=false`,
    ),
    clickup<{ folders: ReadonlyArray<{ lists: ReadonlyArray<{ id: string; name: string }> }> }>(
      token,
      `/space/${spaceId}/folder?archived=false`,
    ),
  ]);
  return [...folderless.lists, ...folders.folders.flatMap((folder) => folder.lists)].map(
    (list) => ({
      id: list.id,
      name: list.name,
      spaceId,
    }),
  );
}

export async function fetchTasks(
  token: string,
  listId: string,
): Promise<ReadonlyArray<ClickUpTask>> {
  const body = await clickup<{ tasks: ReadonlyArray<ClickUpTask> }>(
    token,
    `/list/${listId}/task?subtasks=true&include_closed=true`,
  );
  return body.tasks;
}

export async function fetchListStatuses(
  token: string,
  listId: string,
): Promise<ReadonlyArray<ClickUpListStatus>> {
  const body = await clickup<{ statuses: ReadonlyArray<ClickUpListStatus> }>(
    token,
    `/list/${listId}`,
  );
  return [...body.statuses].sort((left, right) => left.orderindex - right.orderindex);
}

export async function updateTaskStatus(
  token: string,
  taskId: string,
  status: string,
): Promise<void> {
  await clickup<unknown>(token, `/task/${taskId}`, { method: "PUT", body: { status } });
}

export async function createTask(
  token: string,
  listId: string,
  name: string,
  status?: string,
): Promise<ClickUpTask> {
  return clickup<ClickUpTask>(token, `/list/${listId}/task`, {
    method: "POST",
    body: { name, status },
  });
}

const DEMO_TASKS: ReadonlyArray<ClickUpTask> = [
  {
    id: "demo-1",
    name: "Ship the ClickUp integration",
    url: "https://app.clickup.com",
    status: { status: "in progress", color: "#4466ff" },
    priority: { priority: "1" },
    due_date: String(Date.now() + 86_400_000),
    assignees: [{ id: 1, username: "Loi Do", initials: "LD", color: "#7b68ee" }],
  },
  {
    id: "demo-2",
    name: "Rename the app to LD Code",
    url: "https://app.clickup.com",
    status: { status: "complete", color: "#008844" },
    priority: { priority: "2" },
    due_date: null,
    assignees: [{ id: 1, username: "Loi Do", initials: "LD", color: "#7b68ee" }],
  },
  {
    id: "demo-3",
    name: "Review nightly build",
    url: "https://app.clickup.com",
    status: { status: "to do", color: "#87909e" },
    priority: null,
    due_date: String(Date.now() + 3 * 86_400_000),
    assignees: [],
  },
  {
    id: "demo-4",
    name: "Clone the ClickUp list view",
    url: "https://app.clickup.com",
    status: { status: "in progress", color: "#4466ff" },
    priority: { priority: "3" },
    due_date: String(Date.now() + 2 * 86_400_000),
    assignees: [{ id: 2, username: "Agent", initials: "AG", color: "#ff9d42" }],
  },
  {
    id: "demo-5",
    name: "Write the token setup guide",
    url: "https://app.clickup.com",
    status: { status: "to do", color: "#87909e" },
    priority: { priority: "4" },
    due_date: null,
    assignees: [],
  },
];

export const DEMO_WORKSPACE = { id: "demo", name: "LD Labs" } as const;

export const DEMO_SPACES: ReadonlyArray<ClickUpSpace> = [
  { id: "demo-space-product", name: "Product" },
  { id: "demo-space-engineering", name: "Engineering" },
];

export const DEMO_LISTS: ReadonlyArray<ClickUpList> = [
  { id: "demo-list-sprint", name: "Sprint 42", spaceId: "demo-space-product" },
  { id: "demo-list-backlog", name: "Backlog", spaceId: "demo-space-product" },
  { id: "demo-list-bugs", name: "Bugs", spaceId: "demo-space-engineering" },
];

export const DEMO_STATUSES: ReadonlyArray<ClickUpListStatus> = [
  { status: "to do", color: "#87909e", orderindex: 0 },
  { status: "in progress", color: "#4466ff", orderindex: 1 },
  { status: "complete", color: "#008844", orderindex: 2 },
];

export function demoTasks(_listId: string): ReadonlyArray<ClickUpTask> {
  return DEMO_TASKS;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ClickUpApiError) {
    if (error.status === 401)
      return "ClickUp rejected this token. Generate a new one and try again.";
    if (error.status === 429) return "ClickUp rate limit reached. Wait a moment and retry.";
    return error.message;
  }
  if (error instanceof TypeError) {
    return "Could not reach ClickUp. Check your network connection.";
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Open tasks assigned to the token's owner across every workspace, most recently updated first. */
export async function fetchMyTasks(token: string): Promise<ReadonlyArray<ClickUpTask>> {
  const [identity, workspaces] = await Promise.all([fetchIdentity(token), fetchWorkspaces(token)]);
  const pages = await Promise.all(
    workspaces.map((workspace) =>
      clickup<{ tasks: ReadonlyArray<ClickUpTask> }>(
        token,
        `/team/${workspace.id}/task?assignees[]=${identity.id}&subtasks=true&order_by=updated`,
      ),
    ),
  );
  return pages.flatMap((page) => page.tasks);
}

export type ClickUpTaskDetail = ClickUpTask & {
  readonly markdown_description?: string | null;
  readonly description?: string | null;
  readonly list?: { readonly name: string } | null;
  readonly tags?: ReadonlyArray<{ readonly name: string }>;
  readonly subtasks?: ReadonlyArray<{
    readonly name: string;
    readonly status?: { readonly status: string };
  }>;
  readonly checklists?: ReadonlyArray<{
    readonly name: string;
    readonly items: ReadonlyArray<{ readonly name: string; readonly resolved: boolean }>;
  }>;
};

export async function fetchTaskDetail(token: string, taskId: string): Promise<ClickUpTaskDetail> {
  return clickup<ClickUpTaskDetail>(
    token,
    `/task/${taskId}?include_subtasks=true&include_markdown_description=true`,
  );
}
