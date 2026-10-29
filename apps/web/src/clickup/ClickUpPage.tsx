import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FlagIcon,
  ListIcon,
  PlugZapIcon,
  PlusIcon,
  SearchIcon,
  SquareKanbanIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { sortScopedProjectsForSidebar } from "~/components/Sidebar.logic";
import { toastManager } from "~/components/ui/toast";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  createTask,
  DEMO_LISTS,
  DEMO_SPACES,
  DEMO_STATUSES,
  DEMO_WORKSPACE,
  demoTasks,
  errorMessage,
  fetchIdentity,
  fetchLists,
  fetchListStatuses,
  fetchSpaces,
  fetchTasks,
  fetchWorkspaces,
  invalidateClickUpCache,
  readClickUpAccounts,
  readLastClickUpList,
  removeClickUpAccount,
  saveClickUpAccount,
  saveLastClickUpList,
  updateTaskStatus,
  type ClickUpAccount,
  type ClickUpIdentity,
  type ClickUpList,
  type ClickUpListStatus,
  type ClickUpSpace,
  type ClickUpTask,
  type ClickUpWorkspace,
} from "./api";
import { buildClickUpTaskContext, fillClickUpTaskChip } from "./clickupTaskMentions";

const STATUS_GROUP_FALLBACK_COLOR = "#87909e";
const PRIORITY_COLORS: Record<string, string> = {
  "1": "#e5484d",
  "2": "#f5a623",
  "3": "#4466ff",
  "4": "#87909e",
};
const PRIORITY_LABELS: Record<string, string> = {
  "1": "Urgent",
  "2": "High",
  "3": "Normal",
  "4": "Low",
};

type Mode = "gate" | "live" | "demo";
type View = "list" | "board";
type NewTaskDraft = { readonly status: string; readonly name: string };
type StatusGroup = readonly [string, { color: string; tasks: Array<ClickUpTask> }];
const SPACE_COLORS = ["#7b68ee", "#f9be33", "#1db954", "#ff7fab", "#0ab1e6", "#e5484d"];

function formatDueDate(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const value = Number(dueDate);
  if (!Number.isFinite(value)) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isOverdue(dueDate: string | null): boolean {
  return dueDate !== null && Number(dueDate) < Date.now();
}

// Ordered like ClickUp: by the list's status order, with statuses unknown to the list last.
function groupTasksByStatus(
  tasks: ReadonlyArray<ClickUpTask>,
  statuses: ReadonlyArray<ClickUpListStatus>,
): Array<StatusGroup> {
  const groups = new Map<string, { color: string; tasks: Array<ClickUpTask> }>();
  for (const status of [...statuses].toSorted((a, b) => a.orderindex - b.orderindex)) {
    groups.set(status.status, { color: status.color, tasks: [] });
  }
  for (const task of tasks) {
    const key = task.status?.status ?? "no status";
    const group = groups.get(key) ?? {
      color: task.status?.color ?? STATUS_GROUP_FALLBACK_COLOR,
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

export function ClickUpPage() {
  const [accounts, setAccounts] = useState(readClickUpAccounts);
  const token = accounts[0]?.token ?? null;
  const workspaceId = accounts[0]?.workspaceId;
  const [mode, setMode] = useState<Mode>(() => (token ? "live" : "gate"));
  const [identity, setIdentity] = useState<ClickUpIdentity | null>(null);
  const [workspace, setWorkspace] = useState<ClickUpWorkspace | null>(null);
  const [workspaces, setWorkspaces] = useState<ReadonlyArray<ClickUpWorkspace>>([]);
  const [tokenDraft, setTokenDraft] = useState("");
  const [spaces, setSpaces] = useState<ReadonlyArray<ClickUpSpace>>([]);
  const [lists, setLists] = useState<Readonly<Record<string, ReadonlyArray<ClickUpList>>>>({});
  const [openSpaceIds, setOpenSpaceIds] = useState<ReadonlyArray<string>>([]);
  const [selectedList, setSelectedList] = useState<ClickUpList | null>(null);
  const [statuses, setStatuses] = useState<ReadonlyArray<ClickUpListStatus>>([]);
  const [tasks, setTasks] = useState<ReadonlyArray<ClickUpTask>>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(() => token !== null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<NewTaskDraft | null>(null);
  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const taskRequest = useRef(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the connected workspace from the ClickUp API whenever the active account or workspace changes
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const commit = async () => {
      try {
        const [user, workspaceList] = await Promise.all([
          fetchIdentity(token),
          fetchWorkspaces(token),
        ]);
        if (cancelled) return;
        const target = workspaceList.find((entry) => entry.id === workspaceId) ?? workspaceList[0];
        if (!target) throw new Error("This ClickUp account has no workspace.");
        const spaceList = await fetchSpaces(token, target.id);
        if (cancelled) return;
        const lastList = readLastClickUpList();
        const firstSpace =
          spaceList.find((space) => space.id === lastList?.spaceId) ?? spaceList[0];
        const spaceLists = firstSpace ? await fetchLists(token, firstSpace.id) : [];
        if (cancelled) return;

        setIdentity(user);
        setWorkspace(target);
        setWorkspaces(workspaceList);
        const workspaceLabel = workspaceList.length > 1 ? "All workspaces" : target.name;
        const stored = readClickUpAccounts()[0];
        if (stored?.email !== user.email || stored.workspaceLabel !== workspaceLabel) {
          saveClickUpAccount({ ...stored, token, email: user.email, workspaceLabel });
          setAccounts(readClickUpAccounts());
        }
        setSpaces(spaceList);
        if (firstSpace) {
          setLists({ [firstSpace.id]: spaceLists });
          setOpenSpaceIds([firstSpace.id]);
        }
        const firstList = spaceLists.find((list) => list.id === lastList?.listId) ?? spaceLists[0];
        if (firstList) {
          const [listTasks, listStatuses] = await Promise.all([
            fetchTasks(token, firstList.id),
            fetchListStatuses(token, firstList.id),
          ]);
          if (cancelled) return;
          setSelectedList(firstList);
          setStatuses(listStatuses);
          setTasks(listTasks);
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      } finally {
        if (!cancelled) setConnecting(false);
      }
    };
    void commit();
    return () => {
      cancelled = true;
    };
  }, [token, workspaceId]);

  const connect = async () => {
    // Pasted tokens can carry invisible characters that fetch rejects in a header.
    const next = tokenDraft.replace(/[^\x21-\x7e]/g, "");
    if (next.length === 0) return;
    if (!next.startsWith("pk_")) {
      setError("That is not an API token. Copy the token that starts with pk_, not a page link.");
      return;
    }
    await addAccount(next);
  };

  const addAccount = async (next: string) => {
    setConnecting(true);
    setError(null);
    try {
      const user = await fetchIdentity(next);
      saveClickUpAccount({ token: next, email: user.email });
      if (next === token) setConnecting(false);
      else resetWorkspace();
      setAccounts(readClickUpAccounts());
      setMode("live");
      setTokenDraft("");
    } catch (cause) {
      setError(errorMessage(cause));
      setConnecting(false);
    }
  };

  const startDemo = () => {
    setMode("demo");
    setError(null);
    setWorkspace(DEMO_WORKSPACE);
    setSpaces(DEMO_SPACES);
    setLists({
      "demo-space-product": DEMO_LISTS.filter((l) => l.spaceId === "demo-space-product"),
    });
    setOpenSpaceIds(["demo-space-product"]);
    setSelectedList(DEMO_LISTS[0] ?? null);
    setStatuses(DEMO_STATUSES);
    setTasks(demoTasks(DEMO_LISTS[0]?.id ?? ""));
  };

  const resetWorkspace = () => {
    setIdentity(null);
    setWorkspace(null);
    setSpaces([]);
    setLists({});
    setSelectedList(null);
    setStatuses([]);
    setTasks([]);
    setPicked(new Map());
    setError(null);
  };

  const switchAccount = (account: ClickUpAccount) => {
    if (account.token === token) return;
    saveClickUpAccount(account);
    resetWorkspace();
    setWorkspaces([]);
    setConnecting(true);
    setAccounts(readClickUpAccounts());
  };

  const switchWorkspace = (next: ClickUpWorkspace) => {
    const account = accounts[0];
    if (!account || next.id === workspace?.id) return;
    saveClickUpAccount({ ...account, workspaceId: next.id });
    resetWorkspace();
    setConnecting(true);
    setAccounts(readClickUpAccounts());
  };

  const disconnect = () => {
    if (token) removeClickUpAccount(token);
    const remaining = readClickUpAccounts();
    resetWorkspace();
    setWorkspaces([]);
    setAccounts(remaining);
    setConnecting(remaining.length > 0);
    setMode(remaining.length > 0 ? "live" : "gate");
  };

  const toggleSpace = async (space: ClickUpSpace) => {
    const isOpen = openSpaceIds.includes(space.id);
    setOpenSpaceIds(
      isOpen ? openSpaceIds.filter((id) => id !== space.id) : [...openSpaceIds, space.id],
    );
    if (isOpen || lists[space.id] || mode !== "live" || !token) return;
    try {
      const spaceLists = await fetchLists(token, space.id);
      setLists((current) => ({ ...current, [space.id]: spaceLists }));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const selectList = async (list: ClickUpList) => {
    setSelectedList(list);
    saveLastClickUpList(list);
    if (mode !== "live" || !token) {
      setStatuses(DEMO_STATUSES);
      setTasks(demoTasks(list.id));
      return;
    }
    const request = taskRequest.current + 1;
    taskRequest.current = request;
    setLoadingTasks(true);
    setError(null);
    try {
      const [listTasks, listStatuses] = await Promise.all([
        fetchTasks(token, list.id),
        fetchListStatuses(token, list.id),
      ]);
      if (taskRequest.current !== request) return;
      setStatuses(listStatuses);
      setTasks(listTasks);
    } catch (cause) {
      if (taskRequest.current === request) setError(errorMessage(cause));
    } finally {
      if (taskRequest.current === request) setLoadingTasks(false);
    }
  };

  const changeStatus = async (task: ClickUpTask, status: ClickUpListStatus) => {
    if (task.status.status === status.status) return;
    const previous = task.status;
    const apply = (next: ClickUpTask["status"]) =>
      setTasks((current) =>
        current.map((entry) => (entry.id === task.id ? { ...entry, status: next } : entry)),
      );

    apply({ status: status.status, color: status.color });
    if (mode !== "live" || !token) return;

    setBusyTaskId(task.id);
    setError(null);
    try {
      await updateTaskStatus(token, task.id, status.status);
    } catch (cause) {
      apply(previous);
      setError(errorMessage(cause));
    } finally {
      setBusyTaskId(null);
    }
  };

  const submitNewTask = async () => {
    const name = newTask?.name.trim() ?? "";
    if (!newTask || name.length === 0 || !selectedList) return;
    const status = statuses.find((entry) => entry.status === newTask.status);
    setCreating(true);
    setError(null);
    try {
      if (mode === "live" && token) {
        const created = await createTask(token, selectedList.id, name, status?.status);
        setTasks((current) => [...current, created]);
      } else {
        setTasks((current) => [
          ...current,
          {
            id: `demo-${Date.now()}`,
            name,
            url: "https://app.clickup.com",
            status: status ?? { status: "to do", color: STATUS_GROUP_FALLBACK_COLOR },
            priority: null,
            due_date: null,
            assignees: [],
          },
        ]);
      }
      setNewTask(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const [picked, setPicked] = useState<ReadonlyMap<string, ClickUpTask>>(() => new Map());
  const togglePicked = (task: ClickUpTask) =>
    setPicked((current) => {
      const next = new Map(current);
      if (!next.delete(task.id)) next.set(task.id, task);
      return next;
    });
  const handleNewThread = useNewThreadHandler();
  const allProjects = useProjects();
  const threadShells = useThreadShells();
  const projects = sortScopedProjectsForSidebar(
    allProjects.filter((project) => project.isScratch !== true),
    threadShells,
    "updated_at",
  );
  const startThread = async (project: EnvironmentProject) => {
    const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id)).catch(
      () => null,
    );
    if (opened === null) {
      toastManager.add({ type: "error", title: "Could not open a thread" });
      return;
    }
    const store = useComposerDraftStore.getState();
    const tasks = [...picked.values()];
    setPicked(new Map());
    for (const task of tasks) {
      store.addReviewComment(opened.draftId, buildClickUpTaskContext(task), {
        insertAtCaret: false,
      });
      void fillClickUpTaskChip(opened.draftId, task);
    }
  };

  const needle = query.trim().toLowerCase();
  const groupedTasks = groupTasksByStatus(
    needle ? tasks.filter((task) => task.name.toLowerCase().includes(needle)) : tasks,
    statuses,
  );
  const activeSpaceName =
    spaces.find((space) => space.id === selectedList?.spaceId)?.name ??
    workspace?.name ??
    "ClickUp";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-sm text-foreground">
      <aside className="flex w-62 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                disabled={mode !== "live"}
                className="flex items-center gap-2.5 px-3.5 pt-4 pb-3 text-left enabled:hover:bg-sidebar-row-hover"
              />
            }
          >
            <div className="grid size-7 place-items-center rounded-md bg-primary text-2xs font-bold text-primary-foreground">
              {(workspace?.name ?? "CU").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-sidebar-foreground">
                {workspace?.name ?? "ClickUp"}
              </div>
              <div className="truncate text-2xs text-muted-foreground">
                {mode === "demo" ? "Sample workspace" : (identity?.email ?? "Workspace")}
              </div>
            </div>
            {mode === "live" ? (
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
          </MenuTrigger>
          <MenuPopup align="start" side="bottom">
            {workspaces.length > 1 ? (
              <>
                <MenuGroup>
                  <MenuGroupLabel>Workspaces</MenuGroupLabel>
                  <MenuRadioGroup value={workspace?.id ?? ""}>
                    {workspaces.map((entry) => (
                      <MenuRadioItem
                        key={entry.id}
                        value={entry.id}
                        onClick={() => switchWorkspace(entry)}
                      >
                        {entry.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
              </>
            ) : null}
            <MenuGroup>
              <MenuGroupLabel>Accounts</MenuGroupLabel>
              <MenuRadioGroup value={token ?? ""}>
                {accounts.map((account) => (
                  <MenuRadioItem
                    key={account.token}
                    value={account.token}
                    onClick={() => switchAccount(account)}
                  >
                    {account.email || `Token …${account.token.slice(-4)}`}
                    {account.workspaceLabel ? (
                      <span className="text-muted-foreground">· {account.workspaceLabel}</span>
                    ) : null}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuItem
              onClick={() => {
                setError(null);
                setMode("gate");
              }}
            >
              <PlusIcon className="size-3.5" />
              Add account
            </MenuItem>
          </MenuPopup>
        </Menu>

        <div className="px-3.5 pb-1.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          Spaces
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          {spaces.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {connecting ? "Loading spaces…" : "No spaces yet"}
            </div>
          ) : (
            spaces.map((space, index) => {
              const isOpen = openSpaceIds.includes(space.id);
              return (
                <div key={space.id}>
                  <button
                    type="button"
                    onClick={() => void toggleSpace(space)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-row-hover"
                  >
                    {isOpen ? (
                      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className="grid size-5 shrink-0 place-items-center rounded-sm text-3xs font-bold text-white"
                      style={{ backgroundColor: SPACE_COLORS[index % SPACE_COLORS.length] }}
                    >
                      {space.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="truncate">{space.name}</span>
                  </button>
                  {isOpen
                    ? (lists[space.id] ?? []).map((list) => (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => void selectList(list)}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 pl-12 text-left text-sm hover:bg-sidebar-row-hover",
                            selectedList?.id === list.id
                              ? "bg-sidebar-row-selected text-sidebar-foreground"
                              : "text-sidebar-foreground",
                          )}
                        >
                          <ListIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{list.name}</span>
                        </button>
                      ))
                    : null}
                </div>
              );
            })
          )}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          {mode === "live" ? (
            <button
              type="button"
              onClick={disconnect}
              className="w-full rounded-md px-2 py-1.5 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            >
              Disconnect {identity?.email ?? "account"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => (token ? setMode("gate") : disconnect())}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            >
              <PlugZapIcon className="size-3.5" />
              Connect your workspace
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="truncate text-muted-foreground">{activeSpaceName}</span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
            <span className="truncate font-semibold">{selectedList?.name ?? "All tasks"}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">{tasks.length} tasks</span>
            <button
              type="button"
              onClick={() => {
                if (!selectedList) return;
                invalidateClickUpCache(`/list/${selectedList.id}`);
                void selectList(selectedList);
              }}
              disabled={mode !== "live" || !selectedList}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
              aria-label="Refresh tasks"
            >
              <RefreshIcon refreshing={loadingTasks} className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setNewTask({ status: statuses[0]?.status ?? "", name: "" })}
              disabled={mode === "gate" || !selectedList || statuses.length === 0}
              className="flex items-center gap-1 rounded-md border border-input px-2 py-1.5 text-xs font-medium text-secondary-label hover:bg-accent disabled:opacity-40"
            >
              <PlusIcon className="size-3.5" />
              New task
            </button>
            <a
              href="https://app.clickup.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open ClickUp
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </div>
        </header>

        {mode !== "gate" ? (
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
            {(
              [
                ["list", "List", ListIcon],
                ["board", "Board", SquareKanbanIcon],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                className={cn(
                  "flex h-full items-center gap-1.5 border-b-2 px-2 text-sm",
                  view === value
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
            <div className="ml-auto w-56">
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="Search tasks…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>
            </div>
          </div>
        ) : null}

        {error && mode !== "gate" ? (
          <div className="border-b border-error/30 bg-error-surface px-4 py-2 text-xs text-error">
            {error}
          </div>
        ) : null}

        {picked.size > 0 ? (
          <div className="flex items-center gap-3 border-b border-border bg-accent px-4 py-1.5 text-xs">
            <span className="font-medium">
              {picked.size} {picked.size === 1 ? "task" : "tasks"} selected
            </span>
            <button
              type="button"
              onClick={() => setPicked(new Map())}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    disabled={projects.length === 0}
                    className="ml-auto flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  />
                }
              >
                {projects.length === 0 ? "No projects to start a thread in" : "Start thread in…"}
                <ChevronDownIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" side="bottom">
                {projects.map((project) => (
                  <MenuItem
                    key={`${project.environmentId}:${project.id}`}
                    onClick={() => void startThread(project)}
                  >
                    {project.title}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === "gate" ? (
            <ConnectGate
              onCancel={token ? () => setMode("live") : undefined}
              draft={tokenDraft}
              onDraftChange={setTokenDraft}
              onConnect={() => void connect()}
              onDemo={startDemo}
              connecting={connecting}
              error={error}
            />
          ) : (
            <TaskView
              view={view}
              groups={groupedTasks}
              statuses={statuses}
              loading={loadingTasks || connecting}
              isDemo={mode === "demo"}
              busyTaskId={busyTaskId}
              picked={picked}
              onTogglePicked={togglePicked}
              newTask={newTask}
              creating={creating}
              onNewTaskChange={setNewTask}
              onSubmitNewTask={() => void submitNewTask()}
              onChangeStatus={(task, status) => void changeStatus(task, status)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectGate({
  onCancel,
  draft,
  onDraftChange,
  onConnect,
  onDemo,
  connecting,
  error,
}: {
  onCancel: (() => void) | undefined;
  draft: string;
  onDraftChange: (value: string) => void;
  onConnect: () => void;
  onDemo: () => void;
  connecting: boolean;
  error: string | null;
}) {
  return (
    <div className="grid min-h-full place-items-center bg-muted px-6 py-12">
      <div className="w-full max-w-105 rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="mb-4 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
          <PlugZapIcon className="size-5" />
        </div>
        <h1 className="text-base font-semibold">Connect ClickUp</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Paste a ClickUp personal API token to browse and update your spaces, lists and tasks
          without leaving LD Code.
        </p>

        <label
          className="mt-5 block text-xs font-medium text-secondary-label"
          htmlFor="clickup-token"
        >
          Personal API token
        </label>
        <div className="mt-1.5">
          <InputGroup>
            <InputGroupInput
              id="clickup-token"
              type="password"
              placeholder="pk_12345_ABCDEFG"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onConnect();
              }}
            />
          </InputGroup>
        </div>
        <p className="mt-1.5 text-2xs text-muted-foreground/70">
          Stored in this browser only. Generate one at{" "}
          <a
            className="text-primary hover:underline"
            href="https://app.clickup.com/settings/apps"
            target="_blank"
            rel="noreferrer"
          >
            ClickUp Settings, Apps
          </a>
          .
        </p>
        <ol className="mt-3 list-decimal space-y-1 rounded-md bg-muted py-2.5 pr-3 pl-7 text-2xs leading-relaxed text-muted-foreground">
          <li>Open ClickUp Settings, Apps (the link above).</li>
          <li>Under API tokens, click Create token. It reaches all your workspaces.</li>
          <li>
            Skip Integrations, ClickUp API in a workspace&apos;s settings: that token only reaches
            that one workspace.
          </li>
          <li>Copy the token starting with pk_ and paste it above.</li>
        </ol>

        {error ? <p className="mt-3 text-xs text-error">{error}</p> : null}

        <button
          type="button"
          onClick={onConnect}
          disabled={connecting || draft.trim().length === 0}
          className="mt-5 h-9 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect workspace"}
        </button>
        <button
          type="button"
          onClick={onCancel ?? onDemo}
          className="mt-2 h-9 w-full rounded-md border border-input text-sm font-medium text-secondary-label hover:bg-accent"
        >
          {onCancel ? "Cancel" : "Preview with sample data"}
        </button>
      </div>
    </div>
  );
}

type TaskViewProps = {
  view: View;
  groups: ReadonlyArray<StatusGroup>;
  statuses: ReadonlyArray<ClickUpListStatus>;
  loading: boolean;
  isDemo: boolean;
  busyTaskId: string | null;
  picked: ReadonlyMap<string, ClickUpTask>;
  onTogglePicked: (task: ClickUpTask) => void;
  newTask: NewTaskDraft | null;
  creating: boolean;
  onNewTaskChange: (value: NewTaskDraft | null) => void;
  onSubmitNewTask: () => void;
  onChangeStatus: (task: ClickUpTask, status: ClickUpListStatus) => void;
};

function TaskView(props: TaskViewProps) {
  const { view, groups, loading, isDemo, newTask } = props;
  const hasTasks = groups.some(([, group]) => group.tasks.length > 0);
  return (
    <div className={cn("pb-10", view === "board" && "flex h-full flex-col pb-0")}>
      {isDemo ? (
        <div className="border-b border-border bg-accent px-4 py-1.5 text-2xs text-muted-foreground">
          Sample data. Status changes and new tasks stay local until you connect a token.
        </div>
      ) : null}
      {!hasTasks && newTask === null ? (
        <div className="px-5 py-8 text-sm text-muted-foreground">
          {loading ? "Loading tasks…" : "No tasks found."}
        </div>
      ) : null}
      {view === "board" ? <BoardView {...props} /> : <ListView {...props} />}
    </div>
  );
}

function ListView({
  groups,
  statuses,
  busyTaskId,
  picked,
  onTogglePicked,
  newTask,
  creating,
  onNewTaskChange,
  onSubmitNewTask,
  onChangeStatus,
}: TaskViewProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (status: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });

  // ClickUp hides empty statuses in list view, except the one a new task is being added to.
  return groups
    .filter(([status, group]) => group.tasks.length > 0 || newTask?.status === status)
    .map(([status, group]) => {
      const isCollapsed = collapsed.has(status);
      return (
        <section key={status} className="px-4 pt-4">
          <div className="flex items-center gap-2 pb-1">
            <button
              type="button"
              onClick={() => toggle(status)}
              aria-label={isCollapsed ? `Expand ${status}` : `Collapse ${status}`}
              className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-accent"
            >
              {isCollapsed ? (
                <ChevronRightIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
            </button>
            <span
              className="rounded-sm px-2 py-0.75 text-2xs font-semibold text-white uppercase"
              style={{ backgroundColor: group.color }}
            >
              {status}
            </span>
            <span className="text-xs text-muted-foreground/70">{group.tasks.length}</span>
          </div>
          {isCollapsed ? null : (
            <>
              <div className="flex h-7 items-center gap-3 border-b border-border pr-2 pl-7 text-2xs font-medium text-muted-foreground/70">
                <span className="flex-1">Name</span>
                <span className="w-20">Assignee</span>
                <span className="w-20">Due date</span>
                <span className="w-20">Priority</span>
              </div>
              {group.tasks.map((task) => {
                const due = formatDueDate(task.due_date);
                const priority = task.priority?.priority;
                return (
                  <div
                    key={task.id}
                    className="group flex h-9 items-center gap-3 border-b border-border pr-2 hover:bg-accent"
                  >
                    <PickBox task={task} picked={picked} onToggle={onTogglePicked} />
                    <StatusMenu
                      task={task}
                      statuses={statuses}
                      busy={busyTaskId === task.id}
                      onChange={onChangeStatus}
                    />
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-sm hover:text-primary"
                    >
                      {task.name}
                    </a>
                    <span className="w-20">
                      <Assignees task={task} />
                    </span>
                    <span
                      className={cn(
                        "w-20 text-xs",
                        isOverdue(task.due_date) ? "text-error" : "text-muted-foreground",
                      )}
                    >
                      {due ?? "–"}
                    </span>
                    <span className="flex w-20 items-center gap-1 text-xs text-muted-foreground">
                      {priority ? (
                        <>
                          <FlagIcon
                            className="size-3.5"
                            style={{ color: PRIORITY_COLORS[priority] ?? "#87909e" }}
                          />
                          {PRIORITY_LABELS[priority] ?? "Priority"}
                        </>
                      ) : (
                        "–"
                      )}
                    </span>
                  </div>
                );
              })}
              <AddTask
                status={status}
                newTask={newTask}
                creating={creating}
                onChange={onNewTaskChange}
                onSubmit={onSubmitNewTask}
                className="h-9 border-b border-border pl-7"
              />
            </>
          )}
        </section>
      );
    });
}

function BoardView({
  groups,
  statuses,
  busyTaskId,
  picked,
  onTogglePicked,
  newTask,
  creating,
  onNewTaskChange,
  onSubmitNewTask,
  onChangeStatus,
}: TaskViewProps) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-muted p-4">
      {groups.map(([status, group]) => (
        <section
          key={status}
          className="flex max-h-full w-68 shrink-0 flex-col rounded-lg border-t-3 bg-muted"
          style={{ borderTopColor: group.color }}
        >
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
            <span className="text-2xs font-semibold tracking-wide text-secondary-label uppercase">
              {status}
            </span>
            <span className="text-xs text-muted-foreground/70">{group.tasks.length}</span>
          </div>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {group.tasks.map((task) => {
              const due = formatDueDate(task.due_date);
              const priority = task.priority?.priority;
              return (
                <div
                  key={task.id}
                  className="group flex flex-col gap-2 rounded-md border border-border bg-card p-2.5 shadow-xs hover:border-input"
                >
                  <div className="flex items-start gap-2">
                    <StatusMenu
                      task={task}
                      statuses={statuses}
                      busy={busyTaskId === task.id}
                      onChange={onChangeStatus}
                    />
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 text-sm leading-snug hover:text-primary"
                    >
                      {task.name}
                    </a>
                    <PickBox task={task} picked={picked} onToggle={onTogglePicked} />
                  </div>
                  {due || priority || task.assignees.length > 0 ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Assignees task={task} />
                      {due ? (
                        <span className={cn(isOverdue(task.due_date) && "text-error")}>{due}</span>
                      ) : null}
                      {priority ? (
                        <FlagIcon
                          aria-label={PRIORITY_LABELS[priority] ?? "Priority"}
                          className="ml-auto size-3.5"
                          style={{ color: PRIORITY_COLORS[priority] ?? "#87909e" }}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <AddTask
              status={status}
              newTask={newTask}
              creating={creating}
              onChange={onNewTaskChange}
              onSubmit={onSubmitNewTask}
              className="h-8 rounded-md px-2 hover:bg-accent"
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function AddTask({
  status,
  newTask,
  creating,
  onChange,
  onSubmit,
  className,
}: {
  status: string;
  newTask: NewTaskDraft | null;
  creating: boolean;
  onChange: (value: NewTaskDraft | null) => void;
  onSubmit: () => void;
  className: string;
}) {
  if (newTask?.status !== status) {
    return (
      <button
        type="button"
        onClick={() => onChange({ status, name: "" })}
        className={cn(
          "flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground/70 hover:text-foreground",
          className,
        )}
      >
        <PlusIcon className="size-3.5" />
        Add Task
      </button>
    );
  }
  return (
    <div className={cn("flex items-center gap-2 bg-background", className)}>
      <input
        autoFocus
        value={newTask.name}
        disabled={creating}
        placeholder="Task name"
        onChange={(event) => onChange({ status, name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
          if (event.key === "Escape") onChange(null);
        }}
        onBlur={() => {
          if (newTask.name.trim().length === 0) onChange(null);
        }}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={creating || newTask.name.trim().length === 0}
        className="rounded-md bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {creating ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function PickBox({
  task,
  picked,
  onToggle,
}: {
  task: ClickUpTask;
  picked: ReadonlyMap<string, ClickUpTask>;
  onToggle: (task: ClickUpTask) => void;
}) {
  const checked = picked.has(task.id);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`Select ${task.name}`}
      onClick={() => onToggle(task)}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-xs border",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input opacity-0 group-hover:opacity-100 hover:border-primary focus-visible:opacity-100",
      )}
    >
      {checked ? <CheckIcon className="size-3" /> : null}
    </button>
  );
}

function StatusMenu({
  task,
  statuses,
  busy,
  onChange,
}: {
  task: ClickUpTask;
  statuses: ReadonlyArray<ClickUpListStatus>;
  busy: boolean;
  onChange: (task: ClickUpTask, status: ClickUpListStatus) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            disabled={busy || statuses.length === 0}
            aria-label={`Status: ${task.status.status}`}
            className="grid size-4 shrink-0 place-items-center rounded-xs border-2 disabled:opacity-50"
            style={{ borderColor: task.status.color }}
          />
        }
      >
        <span className="size-1.5 rounded-xs" style={{ backgroundColor: task.status.color }} />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuRadioGroup
          value={task.status.status}
          onValueChange={(value) => {
            const next = statuses.find((entry) => entry.status === value);
            if (next) onChange(task, next);
          }}
        >
          {statuses.map((entry) => (
            <MenuRadioItem key={entry.status} value={entry.status} closeOnClick>
              <span className="flex items-center gap-2 uppercase">
                <span className="size-2.5 rounded-xs" style={{ backgroundColor: entry.color }} />
                {entry.status}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function Assignees({ task }: { task: ClickUpTask }) {
  if (task.assignees.length === 0)
    return <span className="text-xs text-muted-foreground/70">–</span>;
  return (
    <span className="flex shrink-0 -space-x-1">
      {task.assignees.slice(0, 3).map((assignee) => (
        <span
          key={assignee.id}
          aria-label={assignee.username}
          className="grid size-6 place-items-center rounded-full border-2 border-background text-4xs font-semibold text-white"
          style={{ backgroundColor: assignee.color }}
        >
          {assignee.initials}
        </span>
      ))}
    </span>
  );
}
