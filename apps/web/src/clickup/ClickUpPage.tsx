import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FlagIcon,
  PlugZapIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { sortScopedProjectsForSidebar } from "~/components/Sidebar.logic";
import { toastManager } from "~/components/ui/toast";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "~/components/ui/menu";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  clearClickUpToken,
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
  readClickUpToken,
  readLastClickUpList,
  saveClickUpToken,
  saveLastClickUpList,
  updateTaskStatus,
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

function formatDueDate(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const value = Number(dueDate);
  if (!Number.isFinite(value)) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function groupTasksByStatus(tasks: ReadonlyArray<ClickUpTask>) {
  const groups = new Map<string, { color: string; tasks: Array<ClickUpTask> }>();
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
  const [token, setToken] = useState<string | null>(() => readClickUpToken());
  const [mode, setMode] = useState<Mode>(() => (readClickUpToken() ? "live" : "gate"));
  const [identity, setIdentity] = useState<ClickUpIdentity | null>(null);
  const [workspace, setWorkspace] = useState<ClickUpWorkspace | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [spaces, setSpaces] = useState<ReadonlyArray<ClickUpSpace>>([]);
  const [lists, setLists] = useState<Readonly<Record<string, ReadonlyArray<ClickUpList>>>>({});
  const [openSpaceIds, setOpenSpaceIds] = useState<ReadonlyArray<string>>([]);
  const [selectedList, setSelectedList] = useState<ClickUpList | null>(null);
  const [statuses, setStatuses] = useState<ReadonlyArray<ClickUpListStatus>>([]);
  const [tasks, setTasks] = useState<ReadonlyArray<ClickUpTask>>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(() => readClickUpToken() !== null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const taskRequest = useRef(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the connected workspace from the ClickUp API whenever the stored token changes
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
        const target = workspaceList[0];
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
  }, [token]);

  const connect = async () => {
    const next = tokenDraft.trim();
    if (next.length === 0) return;
    setConnecting(true);
    setError(null);
    try {
      await fetchIdentity(next);
      saveClickUpToken(next);
      setToken(next);
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

  const disconnect = () => {
    clearClickUpToken();
    setToken(null);
    setMode("gate");
    setIdentity(null);
    setWorkspace(null);
    setSpaces([]);
    setLists({});
    setSelectedList(null);
    setStatuses([]);
    setTasks([]);
    setError(null);
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
    const name = newTaskName?.trim() ?? "";
    if (name.length === 0 || !selectedList) return;
    const fallbackStatus = statuses[0];
    setCreating(true);
    setError(null);
    try {
      if (mode === "live" && token) {
        const created = await createTask(token, selectedList.id, name);
        setTasks((current) => [...current, created]);
      } else {
        setTasks((current) => [
          ...current,
          {
            id: `demo-${Date.now()}`,
            name,
            url: "https://app.clickup.com",
            status: fallbackStatus ?? { status: "to do", color: STATUS_GROUP_FALLBACK_COLOR },
            priority: null,
            due_date: null,
            assignees: [],
          },
        ]);
      }
      setNewTaskName(null);
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

  const groupedTasks = groupTasksByStatus(tasks);
  const activeSpaceName =
    spaces.find((space) => space.id === selectedList?.spaceId)?.name ??
    workspace?.name ??
    "ClickUp";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-white text-sm text-clickup-text">
      <aside className="flex w-62 shrink-0 flex-col bg-clickup-sidebar text-clickup-sidebar-text">
        <div className="flex items-center gap-2.5 px-3.5 pt-4 pb-3">
          <div className="grid size-7 place-items-center rounded-md bg-clickup-accent text-2xs font-bold text-white">
            {(workspace?.name ?? "CU").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {workspace?.name ?? "ClickUp"}
            </div>
            <div className="truncate text-2xs text-clickup-muted">
              {mode === "demo" ? "Sample workspace" : (identity?.email ?? "Workspace")}
            </div>
          </div>
        </div>

        <div className="px-3.5 pb-1.5 text-2xs font-semibold tracking-wide text-clickup-muted uppercase">
          Spaces
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          {spaces.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-clickup-muted">
              {connecting ? "Loading spaces…" : "No spaces yet"}
            </div>
          ) : (
            spaces.map((space) => {
              const isOpen = openSpaceIds.includes(space.id);
              return (
                <div key={space.id}>
                  <button
                    type="button"
                    onClick={() => void toggleSpace(space)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/6"
                  >
                    {isOpen ? (
                      <ChevronDownIcon className="size-3.5 shrink-0 text-clickup-muted" />
                    ) : (
                      <ChevronRightIcon className="size-3.5 shrink-0 text-clickup-muted" />
                    )}
                    <span className="truncate">{space.name}</span>
                  </button>
                  {isOpen
                    ? (lists[space.id] ?? []).map((list) => (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => void selectList(list)}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 pl-6.5 text-left text-sm hover:bg-white/6",
                            selectedList?.id === list.id
                              ? "bg-clickup-sidebar-hover text-white"
                              : "text-clickup-sidebar-text",
                          )}
                        >
                          <span className="size-2 shrink-0 rounded-xs bg-clickup-accent" />
                          <span className="truncate">{list.name}</span>
                        </button>
                      ))
                    : null}
                </div>
              );
            })
          )}
        </nav>

        <div className="border-t border-white/8 p-2">
          {mode === "live" ? (
            <button
              type="button"
              onClick={disconnect}
              className="w-full rounded-md px-2 py-1.5 text-left text-xs text-clickup-muted hover:bg-white/6 hover:text-white"
            >
              Disconnect ClickUp
            </button>
          ) : (
            <button
              type="button"
              onClick={disconnect}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-clickup-muted hover:bg-white/6 hover:text-white"
            >
              <PlugZapIcon className="size-3.5" />
              Connect your workspace
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-clickup-border px-4">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="truncate text-clickup-muted">{activeSpaceName}</span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-clickup-faint" />
            <span className="truncate font-semibold">{selectedList?.name ?? "All tasks"}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-xs text-clickup-muted">{tasks.length} tasks</span>
            <button
              type="button"
              onClick={() => {
                if (!selectedList) return;
                invalidateClickUpCache(`/list/${selectedList.id}`);
                void selectList(selectedList);
              }}
              disabled={mode !== "live" || !selectedList}
              className="grid size-7 place-items-center rounded-md text-clickup-muted hover:bg-clickup-icon-hover disabled:opacity-40"
              aria-label="Refresh tasks"
            >
              <RefreshIcon refreshing={loadingTasks} className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setNewTaskName("")}
              disabled={mode === "gate" || !selectedList}
              className="flex items-center gap-1 rounded-md border border-clickup-input-border px-2 py-1.5 text-xs font-medium text-clickup-label hover:bg-clickup-row-hover disabled:opacity-40"
            >
              <PlusIcon className="size-3.5" />
              New task
            </button>
            <a
              href="https://app.clickup.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md bg-clickup-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-clickup-accent-hover"
            >
              Open ClickUp
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </div>
        </header>

        {error ? (
          <div className="border-b border-error/30 bg-error-surface px-4 py-2 text-xs text-error">
            {error}
          </div>
        ) : null}

        {picked.size > 0 ? (
          <div className="flex items-center gap-3 border-b border-clickup-row-border bg-clickup-row-hover px-4 py-1.5 text-xs">
            <span className="font-medium">
              {picked.size} {picked.size === 1 ? "task" : "tasks"} selected
            </span>
            <button
              type="button"
              onClick={() => setPicked(new Map())}
              className="text-clickup-muted hover:text-clickup-text"
            >
              Clear
            </button>
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    disabled={projects.length === 0}
                    className="ml-auto flex items-center gap-1 rounded-md bg-clickup-accent px-2.5 py-1 font-medium text-white hover:bg-clickup-accent-hover disabled:opacity-50"
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
              draft={tokenDraft}
              onDraftChange={setTokenDraft}
              onConnect={() => void connect()}
              onDemo={startDemo}
              connecting={connecting}
              error={error}
            />
          ) : (
            <TaskList
              groups={groupedTasks}
              statuses={statuses}
              loading={loadingTasks || connecting}
              isDemo={mode === "demo"}
              listName={selectedList?.name ?? "ClickUp"}
              busyTaskId={busyTaskId}
              picked={picked}
              onTogglePicked={togglePicked}
              newTaskName={newTaskName}
              creating={creating}
              onNewTaskNameChange={setNewTaskName}
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
  draft,
  onDraftChange,
  onConnect,
  onDemo,
  connecting,
  error,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onConnect: () => void;
  onDemo: () => void;
  connecting: boolean;
  error: string | null;
}) {
  return (
    <div className="grid min-h-full place-items-center bg-clickup-surface px-6 py-12">
      <div className="w-full max-w-105 rounded-xl border border-clickup-border bg-white p-6 shadow-xs">
        <div className="mb-4 grid size-10 place-items-center rounded-lg bg-clickup-accent text-white">
          <PlugZapIcon className="size-5" />
        </div>
        <h1 className="text-base font-semibold">Connect ClickUp</h1>
        <p className="mt-1 text-sm leading-relaxed text-clickup-muted">
          Paste a ClickUp personal API token to browse and update your spaces, lists and tasks
          without leaving LD Code.
        </p>

        <label
          className="mt-5 block text-xs font-medium text-clickup-label"
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
        <p className="mt-1.5 text-2xs text-clickup-faint">
          Stored in this browser only. Generate one at{" "}
          <a
            className="text-clickup-accent hover:underline"
            href="https://app.clickup.com/settings/apps"
            target="_blank"
            rel="noreferrer"
          >
            ClickUp Settings, Apps
          </a>
          .
        </p>

        {error ? <p className="mt-3 text-xs text-error">{error}</p> : null}

        <button
          type="button"
          onClick={onConnect}
          disabled={connecting || draft.trim().length === 0}
          className="mt-5 h-9 w-full rounded-md bg-clickup-accent text-sm font-medium text-white hover:bg-clickup-accent-hover disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect workspace"}
        </button>
        <button
          type="button"
          onClick={onDemo}
          className="mt-2 h-9 w-full rounded-md border border-clickup-input-border text-sm font-medium text-clickup-label hover:bg-clickup-row-hover"
        >
          Preview with sample data
        </button>
      </div>
    </div>
  );
}

function TaskList({
  groups,
  statuses,
  loading,
  isDemo,
  listName,
  busyTaskId,
  picked,
  onTogglePicked,
  newTaskName,
  creating,
  onNewTaskNameChange,
  onSubmitNewTask,
  onChangeStatus,
}: {
  groups: ReadonlyArray<readonly [string, { color: string; tasks: Array<ClickUpTask> }]>;
  statuses: ReadonlyArray<ClickUpListStatus>;
  loading: boolean;
  isDemo: boolean;
  listName: string;
  busyTaskId: string | null;
  picked: ReadonlyMap<string, ClickUpTask>;
  onTogglePicked: (task: ClickUpTask) => void;
  newTaskName: string | null;
  creating: boolean;
  onNewTaskNameChange: (value: string | null) => void;
  onSubmitNewTask: () => void;
  onChangeStatus: (task: ClickUpTask, status: ClickUpListStatus) => void;
}) {
  return (
    <div className="pb-10">
      {isDemo ? (
        <div className="border-b border-clickup-row-border bg-clickup-row-hover px-4 py-1.5 text-2xs text-clickup-muted">
          Sample data. Status changes and new tasks stay local until you connect a token.
        </div>
      ) : null}

      {newTaskName !== null ? (
        <div className="flex items-center gap-3 border-b border-clickup-row-border px-4 py-1.5">
          <span className="size-4 shrink-0 rounded-xs border border-clickup-checkbox" />
          <input
            autoFocus
            value={newTaskName}
            disabled={creating}
            placeholder={`New task in ${listName}`}
            onChange={(event) => onNewTaskNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmitNewTask();
              if (event.key === "Escape") onNewTaskNameChange(null);
            }}
            onBlur={() => {
              if (newTaskName.trim().length === 0) onNewTaskNameChange(null);
            }}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-clickup-faint"
          />
          <button
            type="button"
            onClick={onSubmitNewTask}
            disabled={creating || newTaskName.trim().length === 0}
            className="rounded-md bg-clickup-accent px-2 py-1 text-2xs font-medium text-white hover:bg-clickup-accent-hover disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      ) : null}

      {loading && groups.length === 0 ? (
        <div className="px-5 py-8 text-sm text-clickup-muted">Loading tasks…</div>
      ) : null}
      {!loading && groups.length === 0 ? (
        <div className="px-5 py-8 text-sm text-clickup-muted">No tasks in this list.</div>
      ) : null}

      {groups.map(([status, group]) => (
        <section key={status}>
          <div className="flex items-center gap-2 px-4 pt-4 pb-1.5">
            <span
              className="rounded-sm px-2 py-0.75 text-2xs font-semibold text-white capitalize"
              style={{ backgroundColor: group.color }}
            >
              {status}
            </span>
            <span className="text-xs text-clickup-faint">{group.tasks.length}</span>
          </div>
          {group.tasks.map((task) => {
            const due = formatDueDate(task.due_date);
            const priority = task.priority?.priority;
            const busy = busyTaskId === task.id;
            return (
              <div
                key={task.id}
                className="group flex h-9 items-center gap-3 border-b border-clickup-row-border px-4 hover:bg-clickup-row-hover"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={picked.has(task.id)}
                  aria-label={`Select ${task.name}`}
                  onClick={() => onTogglePicked(task)}
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-xs border",
                    picked.has(task.id)
                      ? "border-clickup-accent bg-clickup-accent text-white"
                      : "border-clickup-checkbox hover:border-clickup-accent",
                  )}
                >
                  {picked.has(task.id) ? <CheckIcon className="size-3" /> : null}
                </button>
                <a
                  href={task.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {task.name}
                </a>

                {priority ? (
                  <span className="flex items-center gap-1 text-2xs text-clickup-muted">
                    <FlagIcon
                      aria-label={PRIORITY_LABELS[priority] ?? "Priority"}
                      className="size-3.5"
                      style={{ color: PRIORITY_COLORS[priority] ?? "#87909e" }}
                    />
                  </span>
                ) : null}
                {due ? <span className="text-xs text-clickup-muted">{due}</span> : null}

                <span className="flex shrink-0 -space-x-1">
                  {task.assignees.slice(0, 2).map((assignee) => (
                    <span
                      key={assignee.id}
                      className="grid size-6 place-items-center rounded-full border-2 border-white text-4xs font-semibold text-white"
                      style={{ backgroundColor: assignee.color }}
                    >
                      {assignee.initials}
                    </span>
                  ))}
                </span>

                <Menu>
                  <MenuTrigger
                    render={
                      <button
                        type="button"
                        disabled={busy || statuses.length === 0}
                        className="rounded-sm px-2 py-0.75 text-2xs font-semibold text-white capitalize disabled:opacity-50"
                        style={{ backgroundColor: task.status.color }}
                      />
                    }
                  >
                    {busy ? "Saving…" : task.status.status}
                  </MenuTrigger>
                  <MenuPopup align="end" side="bottom">
                    <MenuRadioGroup
                      value={task.status.status}
                      onValueChange={(value) => {
                        const next = statuses.find((entry) => entry.status === value);
                        if (next) onChangeStatus(task, next);
                      }}
                    >
                      {statuses.map((entry) => (
                        <MenuRadioItem key={entry.status} value={entry.status} closeOnClick>
                          <span className="flex items-center gap-2 capitalize">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: entry.color }}
                            />
                            {entry.status}
                          </span>
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuPopup>
                </Menu>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
