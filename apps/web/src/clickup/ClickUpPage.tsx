import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  FlagIcon,
  ListIcon,
  ListFilterIcon,
  ListTreeIcon,
  PanelLeftIcon,
  PencilIcon,
  PlugZapIcon,
  PlusIcon,
  SearchIcon,
  SquareKanbanIcon,
  TagIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { requestConfirmDialog } from "~/confirmDialog";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { sortScopedProjectsForSidebar } from "~/components/Sidebar.logic";
import { toastManager } from "~/components/ui/toast";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import ChatMarkdown from "~/components/ChatMarkdown";
import {
  createSubtask,
  createTask,
  createTaskComment,
  deleteTask,
  DEMO_LISTS,
  DEMO_SPACES,
  DEMO_STATUSES,
  DEMO_WORKSPACE,
  demoTasks,
  errorMessage,
  fetchIdentity,
  fetchListMembers,
  fetchLists,
  fetchListStatuses,
  fetchSpaces,
  fetchSpaceTags,
  fetchTaskComments,
  fetchTaskDetail,
  fetchTasks,
  fetchWorkspaces,
  invalidateClickUpCache,
  readClickUpAccounts,
  readLastClickUpList,
  removeClickUpAccount,
  saveClickUpAccount,
  saveLastClickUpList,
  setChecklistItemResolved,
  setTaskTag,
  updateTask,
  updateTaskStatus,
  type ClickUpAccount,
  type ClickUpComment,
  type ClickUpIdentity,
  type ClickUpList,
  type ClickUpListStatus,
  type ClickUpMember,
  type ClickUpSpace,
  type ClickUpTag,
  type ClickUpTask,
  type ClickUpTaskDetail,
  type ClickUpWorkspace,
} from "./api";
import {
  buildClickUpTaskContext,
  fillClickUpTaskChip,
  setClickUpOpenTask,
  useClickUpOpenTaskStore,
} from "./clickupTaskMentions";
import {
  activeFilterCount,
  DUE_FILTER_OPTIONS,
  EMPTY_TASK_FILTERS,
  taskMatchesFilters,
  UNASSIGNED_FILTER,
  type TaskFilters,
} from "./taskFilters";
import { nestSubtasks, SUBTASK_MODE_OPTIONS, type SubtaskMode } from "./subtasks";

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

type PageUiState = {
  readonly view: View;
  readonly sidebarOpen: boolean;
  readonly subtasks: SubtaskMode;
};
const UI_STORAGE_KEY = "ldcode:clickup:ui";

function readPageUiState(): PageUiState {
  const fallback: PageUiState = { view: "list", sidebarOpen: true, subtasks: "collapsed" };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UI_STORAGE_KEY) ?? "{}") as Partial<
      Record<keyof PageUiState, unknown>
    >;
    return {
      view: parsed.view === "board" ? "board" : "list",
      sidebarOpen: parsed.sidebarOpen !== false,
      subtasks:
        parsed.subtasks === "expanded" || parsed.subtasks === "separate"
          ? parsed.subtasks
          : "collapsed",
    };
  } catch {
    return fallback;
  }
}

type TaskThreadRef = { readonly environmentId: string; readonly threadId: string };
const TASK_THREADS_STORAGE_KEY = "t3code:clickup:task-threads";

// shortcut: links live in this browser only, so other clients do not see them; move to the thread record if that matters.
function readTaskThreads(): Record<string, ReadonlyArray<TaskThreadRef>> {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(TASK_THREADS_STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object" ? (parsed as Record<string, TaskThreadRef[]>) : {};
  } catch {
    return {};
  }
}

function threadIsRunning(thread: EnvironmentThreadShell): boolean {
  return threadRuntimeIsActive(thread.runtime);
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
  const [ui, setUi] = useState(readPageUiState);
  const updateUi = (patch: Partial<PageUiState>) => {
    const next = { ...ui, ...patch };
    window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(next));
    setUi(next);
  };
  const { view, sidebarOpen } = ui;
  const setView = (next: View) => updateUi({ view: next });
  const openTaskId = useClickUpOpenTaskStore((state) => state.taskId);
  const setOpenTaskId = setClickUpOpenTask;
  const [unlistedTask, setUnlistedTask] = useState<ClickUpTask | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS);
  // Parents flipped away from the current subtask mode's default.
  const [toggledParents, setToggledParents] = useState<ReadonlySet<string>>(() => new Set());
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
    setFilters(EMPTY_TASK_FILTERS);
    setOpenTaskId(null);
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
    setFilters(EMPTY_TASK_FILTERS);
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
  const [taskThreads, setTaskThreads] = useState(readTaskThreads);
  const threadsByTask = new Map<string, ReadonlyArray<EnvironmentThreadShell>>();
  for (const [taskId, refs] of Object.entries(taskThreads)) {
    const threads = threadShells.filter(
      (thread) =>
        thread.archivedAt === null &&
        refs.some(
          (ref) => ref.environmentId === thread.environmentId && ref.threadId === thread.id,
        ),
    );
    if (threads.length > 0) threadsByTask.set(taskId, threads);
  }
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
    const ref = { environmentId: project.environmentId, threadId: opened.threadId };
    const nextTaskThreads = { ...readTaskThreads() };
    for (const task of tasks) nextTaskThreads[task.id] = [...(nextTaskThreads[task.id] ?? []), ref];
    window.localStorage.setItem(TASK_THREADS_STORAGE_KEY, JSON.stringify(nextTaskThreads));
    setTaskThreads(nextTaskThreads);
    for (const task of tasks) {
      store.addReviewComment(opened.draftId, buildClickUpTaskContext(task), {
        insertAtCaret: false,
      });
      void fillClickUpTaskChip(opened.draftId, task);
    }
  };

  const needle = query.trim().toLowerCase();
  const visibleTasks = tasks.filter(
    (task) =>
      (needle === "" || task.name.toLowerCase().includes(needle)) &&
      taskMatchesFilters(task, filters),
  );
  const nested = nestSubtasks(visibleTasks, ui.subtasks);
  const groupedTasks = groupTasksByStatus(nested.roots, statuses);
  const setSubtaskMode = (subtasks: SubtaskMode) => {
    setToggledParents(new Set());
    updateUi({ subtasks });
  };
  const toggleSubtasks = (taskId: string) =>
    setToggledParents((current) => {
      const next = new Set(current);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    });
  const listedOpenTask = tasks.find((task) => task.id === openTaskId) ?? null;
  const openTask = listedOpenTask ?? (unlistedTask?.id === openTaskId ? unlistedTask : null);
  const fetchUnlistedTask =
    openTaskId !== null && listedOpenTask === null && !loadingTasks && !connecting
      ? openTaskId
      : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a mentioned task can live outside the loaded list, so it is read from the ClickUp API
  useEffect(() => {
    if (fetchUnlistedTask === null || mode !== "live" || !token) return;
    let cancelled = false;
    fetchTaskDetail(token, fetchUnlistedTask).then(
      (task) => {
        if (!cancelled) setUnlistedTask(task);
      },
      (cause) => {
        if (!cancelled) setError(errorMessage(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchUnlistedTask, mode, token]);
  const activeSpaceName =
    spaces.find((space) => space.id === selectedList?.spaceId)?.name ??
    workspace?.name ??
    "ClickUp";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-sm text-foreground">
      <aside
        className={cn(
          "w-62 shrink-0 flex-col bg-sidebar text-sidebar-foreground",
          sidebarOpen ? "flex" : "hidden",
        )}
      >
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

      <div className={cn("min-w-0 flex-1 flex-col", openTask ? "hidden" : "flex")}>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Button
            variant="ghost-muted"
            size="icon-xs"
            onClick={() => updateUi({ sidebarOpen: !sidebarOpen })}
            aria-label={sidebarOpen ? "Hide spaces" : "Show spaces"}
          >
            <PanelLeftIcon />
          </Button>
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="truncate text-muted-foreground">{activeSpaceName}</span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
            <span className="truncate font-semibold">{selectedList?.name ?? "All tasks"}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">
              {visibleTasks.length === tasks.length
                ? `${tasks.length} tasks`
                : `${visibleTasks.length} of ${tasks.length} tasks`}
            </span>
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
            <div className="ml-auto flex items-center gap-2">
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-md border border-input px-2 py-1.5 text-xs font-medium text-secondary-label hover:bg-accent"
                    />
                  }
                >
                  <ListTreeIcon className="size-3.5" />
                  Subtasks
                </MenuTrigger>
                <MenuPopup align="end" side="bottom">
                  <MenuGroup>
                    <MenuGroupLabel>Show subtasks</MenuGroupLabel>
                    <MenuRadioGroup value={ui.subtasks}>
                      {SUBTASK_MODE_OPTIONS.map(([value, label]) => (
                        <MenuRadioItem
                          key={value}
                          value={value}
                          onClick={() => setSubtaskMode(value)}
                        >
                          {label}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                </MenuPopup>
              </Menu>
              <TaskFilterMenu tasks={tasks} filters={filters} onChange={setFilters} />
              <div className="w-56">
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
              onOpenTask={(task) => setOpenTaskId(task.id)}
              threadsByTask={threadsByTask}
              subtasks={nested.children}
              isExpanded={(taskId) => (ui.subtasks === "expanded") !== toggledParents.has(taskId)}
              onToggleSubtasks={toggleSubtasks}
            />
          )}
        </div>
      </div>
      <TaskDetailSheet
        task={openTask}
        token={mode === "live" ? token : null}
        statuses={statuses}
        busy={busyTaskId === openTask?.id}
        threads={(openTask && threadsByTask.get(openTask.id)) ?? []}
        onChangeStatus={(task, status) => void changeStatus(task, status)}
        onTaskSynced={(synced) =>
          setTasks((current) =>
            current.map((entry) =>
              entry.id === synced.id
                ? {
                    ...entry,
                    name: synced.name,
                    status: synced.status,
                    priority: synced.priority,
                    due_date: synced.due_date,
                    assignees: synced.assignees,
                  }
                : entry,
            ),
          )
        }
        onTaskDeleted={(taskId) => {
          setTasks((current) => current.filter((entry) => entry.id !== taskId));
          setOpenTaskId(null);
        }}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}

function TaskFilterMenu({
  tasks,
  filters,
  onChange,
}: {
  tasks: ReadonlyArray<ClickUpTask>;
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
}) {
  const statusOptions = new Map<string, string>();
  const assigneeOptions = new Map<string, string>();
  const tagOptions = new Map<string, string>();
  for (const task of tasks) {
    statusOptions.set(task.status.status, task.status.color);
    for (const assignee of task.assignees) {
      assigneeOptions.set(String(assignee.id), assignee.username);
    }
    for (const tag of task.tags ?? []) {
      tagOptions.set(tag.name, tag.tag_bg ?? STATUS_GROUP_FALLBACK_COLOR);
    }
  }
  const count = activeFilterCount(filters);
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-input px-2 py-1.5 text-xs font-medium text-secondary-label hover:bg-accent"
          />
        }
      >
        <ListFilterIcon className="size-3.5" />
        Filters
        {count > 0 ? (
          <span className="rounded-full bg-primary/15 px-1.5 text-2xs font-semibold text-primary tabular-nums">
            {count}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" width="content">
        <TaskFilterCheckboxGroup
          label="Status"
          Icon={CircleDotIcon}
          options={[...statusOptions].map(([value, color]) => ({ value, label: value, color }))}
          selected={filters.statuses}
          onChange={(statuses) => onChange({ ...filters, statuses })}
        />
        <TaskFilterCheckboxGroup
          label="Assignee"
          Icon={UsersIcon}
          options={[
            { value: UNASSIGNED_FILTER, label: "Unassigned" },
            ...[...assigneeOptions].map(([value, label]) => ({ value, label })),
          ]}
          selected={filters.assignees}
          onChange={(assignees) => onChange({ ...filters, assignees })}
        />
        <TaskFilterCheckboxGroup
          label="Priority"
          Icon={FlagIcon}
          options={[
            ...Object.entries(PRIORITY_LABELS).map(([value, label]) => ({
              value,
              label,
              color: PRIORITY_COLORS[value],
            })),
            { value: "none", label: "No priority" },
          ]}
          selected={filters.priorities}
          onChange={(priorities) => onChange({ ...filters, priorities })}
        />
        {tagOptions.size > 0 ? (
          <TaskFilterCheckboxGroup
            label="Tags"
            Icon={TagIcon}
            options={[...tagOptions].map(([value, color]) => ({ value, label: value, color }))}
            selected={filters.tags}
            onChange={(tags) => onChange({ ...filters, tags })}
          />
        ) : null}
        <MenuSub>
          <MenuSubTrigger>
            <CalendarIcon className="size-3.5" />
            <span className="flex-1">Due date</span>
            <span className="text-xs text-muted-foreground">
              {DUE_FILTER_OPTIONS.find(([value]) => value === filters.due)?.[1] ?? "Any"}
            </span>
          </MenuSubTrigger>
          <MenuSubPopup>
            <MenuRadioGroup value={filters.due ?? ""}>
              <MenuRadioItem value="" onClick={() => onChange({ ...filters, due: null })}>
                Any
              </MenuRadioItem>
              {DUE_FILTER_OPTIONS.map(([value, label]) => (
                <MenuRadioItem
                  key={value}
                  value={value}
                  onClick={() => onChange({ ...filters, due: value })}
                >
                  {label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuItem disabled={count === 0} onClick={() => onChange(EMPTY_TASK_FILTERS)}>
          Clear filters
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function TaskFilterCheckboxGroup({
  label,
  Icon,
  options,
  selected,
  onChange,
}: {
  label: string;
  Icon: ElementType<{ className?: string }>;
  options: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly color?: string | undefined;
  }>;
  selected: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}) {
  return (
    <MenuSub>
      <MenuSubTrigger>
        <Icon className="size-3.5" />
        <span className="flex-1">{label}</span>
        <span className="text-xs text-muted-foreground">
          {selected.length === 0 ? "Any" : `${selected.length} selected`}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        {options.map((option) => (
          <MenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selected, option.value]
                  : selected.filter((value) => value !== option.value),
              )
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              {option.color ? (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: option.color }}
                />
              ) : null}
              <span className="truncate">{option.label}</span>
            </span>
          </MenuCheckboxItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
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
  onOpenTask: (task: ClickUpTask) => void;
  threadsByTask: ReadonlyMap<string, ReadonlyArray<EnvironmentThreadShell>>;
  subtasks: ReadonlyMap<string, ReadonlyArray<ClickUpTask>>;
  isExpanded: (taskId: string) => boolean;
  onToggleSubtasks: (taskId: string) => void;
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
  onOpenTask,
  threadsByTask,
  subtasks,
  isExpanded,
  onToggleSubtasks,
}: TaskViewProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (status: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });

  const renderRow = (task: ClickUpTask, depth: number): ReactNode => {
    const due = formatDueDate(task.due_date);
    const priority = task.priority?.priority;
    const children = subtasks.get(task.id) ?? [];
    const expanded = children.length > 0 && isExpanded(task.id);
    return (
      <Fragment key={task.id}>
        <div className="group flex h-9 items-center gap-3 border-b border-border pr-2 hover:bg-accent">
          <PickBox task={task} picked={picked} onToggle={onTogglePicked} />
          {depth > 0 ? (
            <span aria-hidden className="shrink-0" style={{ width: depth * 20 }} />
          ) : null}
          <SubtaskToggle
            count={children.length}
            expanded={expanded}
            onToggle={() => onToggleSubtasks(task.id)}
          />
          <StatusMenu
            task={task}
            statuses={statuses}
            busy={busyTaskId === task.id}
            onChange={onChangeStatus}
          />
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onOpenTask(task)}
              className="min-w-0 truncate text-left text-sm hover:text-primary"
            >
              {task.name}
            </button>
            {children.length > 0 ? (
              <SubtaskCount count={children.length} onToggle={() => onToggleSubtasks(task.id)} />
            ) : null}
          </div>
          <TaskThreadsBadge threads={threadsByTask.get(task.id)} />
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
        {expanded ? children.map((child) => renderRow(child, depth + 1)) : null}
      </Fragment>
    );
  };

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
              <div className="flex h-7 items-center gap-3 border-b border-border pr-2 pl-14 text-2xs font-medium text-muted-foreground/70">
                <span className="flex-1">Name</span>
                <span className="w-20">Assignee</span>
                <span className="w-20">Due date</span>
                <span className="w-20">Priority</span>
              </div>
              {group.tasks.map((task) => renderRow(task, 0))}
              <AddTask
                status={status}
                newTask={newTask}
                creating={creating}
                onChange={onNewTaskChange}
                onSubmit={onSubmitNewTask}
                className="h-9 border-b border-border pl-14"
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
  onOpenTask,
  threadsByTask,
  subtasks,
  isExpanded,
  onToggleSubtasks,
}: TaskViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Distance keeps clicks on the name, status menu and pick box from starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const dragging = draggingId
    ? groups.flatMap(([, group]) => group.tasks).find((task) => task.id === draggingId)
    : undefined;
  const cardProps = {
    statuses,
    busyTaskId,
    picked,
    onTogglePicked,
    onChangeStatus,
    onOpenTask,
    subtasks,
    isExpanded,
    onToggleSubtasks,
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => setDraggingId(String(event.active.id))}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={(event) => {
        setDraggingId(null);
        const task = dragging;
        const target = statuses.find((entry) => entry.status === event.over?.id);
        if (task && target) onChangeStatus(task, target);
      }}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-muted p-4">
        {groups.map(([status, group]) => (
          <BoardColumn key={status} status={status} color={group.color} count={group.tasks.length}>
            {group.tasks.map((task) => (
              <BoardCard
                key={task.id}
                task={task}
                threads={threadsByTask.get(task.id)}
                {...cardProps}
              />
            ))}
            <AddTask
              status={status}
              newTask={newTask}
              creating={creating}
              onChange={onNewTaskChange}
              onSubmit={onSubmitNewTask}
              className="h-8 rounded-md px-2 hover:bg-accent"
            />
          </BoardColumn>
        ))}
      </div>
      <DragOverlay>
        {dragging ? (
          <BoardCardBody
            task={dragging}
            threads={threadsByTask.get(dragging.id)}
            className="rotate-2 cursor-grabbing shadow-lg"
            {...cardProps}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  status,
  color,
  count,
  children,
}: {
  status: string;
  color: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex max-h-full w-68 shrink-0 flex-col rounded-lg border-t-3 bg-muted",
        isOver && "bg-accent ring-2 ring-primary/40",
      )}
      style={{ borderTopColor: color }}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="text-2xs font-semibold tracking-wide text-secondary-label uppercase">
          {status}
        </span>
        <span className="text-xs text-muted-foreground/70">{count}</span>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

type BoardCardProps = {
  task: ClickUpTask;
  threads: ReadonlyArray<EnvironmentThreadShell> | undefined;
  statuses: ReadonlyArray<ClickUpListStatus>;
  busyTaskId: string | null;
  picked: ReadonlyMap<string, ClickUpTask>;
  onTogglePicked: (task: ClickUpTask) => void;
  onChangeStatus: (task: ClickUpTask, status: ClickUpListStatus) => void;
  onOpenTask: (task: ClickUpTask) => void;
  subtasks: ReadonlyMap<string, ReadonlyArray<ClickUpTask>>;
  isExpanded: (taskId: string) => boolean;
  onToggleSubtasks: (taskId: string) => void;
};

function BoardCard(props: BoardCardProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: props.task.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="cursor-grab touch-none">
      {/* The overlay follows the pointer; the original stays as a placeholder. */}
      <BoardCardBody {...props} className={cn(isDragging && "opacity-40")} />
    </div>
  );
}

function BoardCardBody({
  task,
  threads,
  statuses,
  busyTaskId,
  picked,
  onTogglePicked,
  onChangeStatus,
  onOpenTask,
  subtasks,
  isExpanded,
  onToggleSubtasks,
  className,
}: BoardCardProps & { className?: string }) {
  const due = formatDueDate(task.due_date);
  const priority = task.priority?.priority;
  const children = subtasks.get(task.id) ?? [];
  const expanded = children.length > 0 && isExpanded(task.id);
  return (
    <div
      className={cn(
        "group flex flex-col gap-2 rounded-md border border-border bg-card p-2.5 shadow-xs hover:border-input",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <StatusMenu
          task={task}
          statuses={statuses}
          busy={busyTaskId === task.id}
          onChange={onChangeStatus}
        />
        <button
          type="button"
          onClick={() => onOpenTask(task)}
          className="min-w-0 flex-1 text-left text-sm leading-snug hover:text-primary"
        >
          {task.name}
        </button>
        <PickBox task={task} picked={picked} onToggle={onTogglePicked} />
      </div>
      <TaskThreadsBadge threads={threads} />
      {due || priority || task.assignees.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Assignees task={task} />
          {due ? <span className={cn(isOverdue(task.due_date) && "text-error")}>{due}</span> : null}
          {priority ? (
            <FlagIcon
              aria-label={PRIORITY_LABELS[priority] ?? "Priority"}
              className="ml-auto size-3.5"
              style={{ color: PRIORITY_COLORS[priority] ?? "#87909e" }}
            />
          ) : null}
        </div>
      ) : null}
      {children.length > 0 ? (
        <div className="-mx-1 flex flex-col">
          <button
            type="button"
            onClick={() => onToggleSubtasks(task.id)}
            aria-expanded={expanded}
            className="flex w-fit items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ListTreeIcon className="size-3.5" />
            {children.length} {children.length === 1 ? "subtask" : "subtasks"}
            {expanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
          </button>
          {expanded
            ? children.map((child) => (
                <div
                  key={child.id}
                  className="flex h-7 items-center gap-2 rounded-sm px-1 hover:bg-accent"
                >
                  <StatusMenu
                    task={child}
                    statuses={statuses}
                    busy={busyTaskId === child.id}
                    onChange={onChangeStatus}
                  />
                  <button
                    type="button"
                    onClick={() => onOpenTask(child)}
                    className="min-w-0 flex-1 truncate text-left text-xs hover:text-primary"
                  >
                    {child.name}
                  </button>
                  <Assignees task={child} />
                </div>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function SubtaskToggle({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (count === 0) return <span aria-hidden className="size-4 shrink-0" />;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
      className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {expanded ? (
        <ChevronDownIcon className="size-3.5" />
      ) : (
        <ChevronRightIcon className="size-3.5" />
      )}
    </button>
  );
}

function SubtaskCount({ count, onToggle }: { count: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${count} ${count === 1 ? "subtask" : "subtasks"}`}
      className="flex shrink-0 items-center gap-0.5 rounded-sm border border-border px-1 text-2xs text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground"
    >
      <ListTreeIcon className="size-3" />
      {count}
    </button>
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
  pill = false,
}: {
  task: ClickUpTask;
  statuses: ReadonlyArray<ClickUpListStatus>;
  busy: boolean;
  onChange: (task: ClickUpTask, status: ClickUpListStatus) => void;
  pill?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          pill ? (
            <button
              type="button"
              disabled={busy || statuses.length === 0}
              className="flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-white uppercase enabled:hover:brightness-110 disabled:opacity-50"
              style={{ backgroundColor: task.status.color }}
            />
          ) : (
            <button
              type="button"
              disabled={busy || statuses.length === 0}
              aria-label={`Status: ${task.status.status}`}
              className="grid size-4 shrink-0 place-items-center rounded-full border-2 disabled:opacity-50"
              style={{ borderColor: task.status.color }}
            />
          )
        }
      >
        {pill ? (
          <>
            {task.status.status}
            <ChevronRightIcon className="size-3.5" />
          </>
        ) : (
          <span className="size-1.5 rounded-full" style={{ backgroundColor: task.status.color }} />
        )}
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
                <span className="size-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
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

function TaskThreadsBadge({
  threads,
}: {
  threads: ReadonlyArray<EnvironmentThreadShell> | undefined;
}) {
  if (!threads || threads.length === 0) return null;
  const running = threads.filter(threadIsRunning).length;
  return (
    <span
      className={cn(
        "flex w-fit shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs font-medium",
        running > 0 ? "bg-success/10 text-success" : "bg-accent text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          running > 0 ? "bg-success" : "bg-muted-foreground/50",
        )}
      />
      {running > 0
        ? `${running} running`
        : `${threads.length} thread${threads.length === 1 ? "" : "s"}`}
    </span>
  );
}

const PRIORITY_OPTIONS = ["1", "2", "3", "4"] as const;

function dueDateInputValue(dueDate: string | null): string {
  if (!dueDate) return "";
  const date = new Date(Number(dueDate));
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const FIELD_LABEL_CLASS = "flex items-center gap-2 text-muted-foreground";

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-8 mb-2 text-sm font-semibold">{children}</h3>;
}

function TaskDetailSheet({
  task,
  token,
  statuses,
  busy,
  threads,
  onChangeStatus,
  onTaskSynced,
  onTaskDeleted,
  onClose,
}: {
  task: ClickUpTask | null;
  token: string | null;
  statuses: ReadonlyArray<ClickUpListStatus>;
  busy: boolean;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  onChangeStatus: (task: ClickUpTask, status: ClickUpListStatus) => void;
  onTaskSynced: (task: ClickUpTaskDetail) => void;
  onTaskDeleted: (taskId: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ClickUpTaskDetail | null>(null);
  const [comments, setComments] = useState<ReadonlyArray<ClickUpComment>>([]);
  const [members, setMembers] = useState<ReadonlyArray<ClickUpMember>>([]);
  const [spaceTags, setSpaceTags] = useState<ReadonlyArray<ClickUpTag>>([]);
  const [detailError, setDetailError] = useState<{ taskId: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const taskId = task?.id;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the opened task, its comments, members and tags from the ClickUp API
  useEffect(() => {
    if (!taskId || !token) return;
    let cancelled = false;
    void (async () => {
      try {
        const [next, nextComments] = await Promise.all([
          fetchTaskDetail(token, taskId),
          fetchTaskComments(token, taskId),
        ]);
        if (cancelled) return;
        setDetail(next);
        setComments(nextComments);
        const [nextMembers, nextTags] = await Promise.all([
          next.list ? fetchListMembers(token, next.list.id) : [],
          next.space ? fetchSpaceTags(token, next.space.id) : [],
        ]);
        if (cancelled) return;
        setMembers(nextMembers);
        setSpaceTags(nextTags);
      } catch (cause) {
        if (!cancelled) setDetailError({ taskId, message: errorMessage(cause) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, token]);

  const loaded = detail?.id === taskId ? detail : null;
  const loadError = detailError && detailError.taskId === taskId ? detailError.message : null;
  const editable = token !== null && loaded !== null && !saving;
  const description = loaded?.markdown_description || loaded?.description || "";
  const priority = task?.priority?.priority;
  const taskTags = loaded?.tags ?? [];

  const run = async (action: (token: string, taskId: string) => Promise<unknown>) => {
    if (!token || !taskId) return false;
    setSaving(true);
    setActionError(null);
    try {
      await action(token, taskId);
      if (action === deleteTask) return true;
      const [next, nextComments] = await Promise.all([
        fetchTaskDetail(token, taskId),
        fetchTaskComments(token, taskId),
      ]);
      setDetail(next);
      setComments(nextComments);
      onTaskSynced(next);
      return true;
    } catch (cause) {
      setActionError(errorMessage(cause));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const resetDrafts = () => {
    setNameDraft(null);
    setDescriptionDraft(null);
    setSubtaskDraft("");
    setCommentDraft("");
    setActionError(null);
  };

  const saveName = async () => {
    const name = nameDraft?.trim();
    setNameDraft(null);
    if (!name || name === task?.name) return;
    await run((token, id) => updateTask(token, id, { name }));
  };

  const saveDescription = async () => {
    if (descriptionDraft === null) return;
    if (await run((token, id) => updateTask(token, id, { markdown_content: descriptionDraft })))
      setDescriptionDraft(null);
  };

  const toggleAssignee = (member: ClickUpMember, assigned: boolean) =>
    void run((token, id) =>
      updateTask(token, id, {
        assignees: assigned ? { add: [], rem: [member.id] } : { add: [member.id], rem: [] },
      }),
    );

  const addSubtask = async () => {
    const name = subtaskDraft.trim();
    const listId = loaded?.list?.id;
    if (!name || !listId) return;
    if (await run((token, id) => createSubtask(token, listId, id, name))) setSubtaskDraft("");
  };

  const addComment = async () => {
    const text = commentDraft.trim();
    if (!text) return;
    if (await run((token, id) => createTaskComment(token, id, text))) setCommentDraft("");
  };

  const remove = async () => {
    if (!task) return;
    const confirmed =
      (await requestConfirmDialog(`Delete "${task.name}" from ClickUp?`, {
        variant: "destructive",
      })) ?? window.confirm(`Delete "${task.name}" from ClickUp?`);
    if (!confirmed) return;
    if (await run(deleteTask)) {
      resetDrafts();
      onTaskDeleted(task.id);
    }
  };

  if (!task) return null;
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-sm">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            resetDrafts();
            onClose();
          }}
          aria-label="Back to tasks"
        >
          <ArrowLeftIcon />
        </Button>
        <ListIcon className="size-3.5" />
        <span className="truncate">{loaded?.list?.name ?? "Task"}</span>
        <ChevronRightIcon className="size-3.5 shrink-0" />
        <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-2xs">
          {task.id}
        </span>
        <a
          href={task.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1 hover:text-foreground"
        >
          Open in ClickUp
          <ExternalLinkIcon className="size-3.5" />
        </a>
        <Button
          variant="ghost-destructive"
          size="icon-xs"
          disabled={!editable}
          onClick={() => void remove()}
          aria-label="Delete task"
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 @max-3xl:flex-col @max-3xl:overflow-y-auto">
        <div className="min-h-0 flex-1 overflow-y-auto px-10 py-6 @max-3xl:flex-none @max-3xl:overflow-visible @max-3xl:px-5">
          <input
            value={nameDraft ?? task.name}
            disabled={!editable}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setNameDraft(null);
            }}
            aria-label="Task name"
            className="w-full rounded-md bg-transparent px-1 -mx-1 text-2xl leading-tight font-bold outline-none hover:bg-accent/50 focus:bg-accent/50"
          />
          {actionError ? <p className="mt-2 text-xs text-error">{actionError}</p> : null}

          <dl className="mt-6 grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-xs lg:grid-cols-[7.5rem_minmax(0,1fr)_7.5rem_minmax(0,1fr)]">
            <dt className={FIELD_LABEL_CLASS}>
              <CircleDotIcon className="size-4" />
              Status
            </dt>
            <dd className="flex items-center gap-2">
              <StatusMenu
                task={task}
                statuses={statuses}
                busy={busy}
                onChange={onChangeStatus}
                pill
              />
            </dd>
            <dt className={FIELD_LABEL_CLASS}>
              <UsersIcon className="size-4" />
              Assignees
            </dt>
            <dd>
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      disabled={!editable}
                      className="flex max-w-full items-center gap-2 rounded-sm px-1 py-0.5 enabled:hover:bg-accent"
                    />
                  }
                >
                  <Assignees task={task} />
                  <span className="truncate">
                    {task.assignees.map((assignee) => assignee.username).join(", ") || "Unassigned"}
                  </span>
                </MenuTrigger>
                <MenuPopup align="start" side="bottom">
                  {members.length === 0 ? (
                    <MenuItem disabled>No members found</MenuItem>
                  ) : (
                    members.map((member) => {
                      const assigned = task.assignees.some((entry) => entry.id === member.id);
                      return (
                        <MenuCheckboxItem
                          key={member.id}
                          checked={assigned}
                          onClick={() => toggleAssignee(member, assigned)}
                        >
                          {member.username}
                        </MenuCheckboxItem>
                      );
                    })
                  )}
                </MenuPopup>
              </Menu>
            </dd>
            <dt className={FIELD_LABEL_CLASS}>
              <CalendarIcon className="size-4" />
              Due date
            </dt>
            <dd className="flex items-center gap-1">
              <Input
                type="date"
                size="compact"
                disabled={!editable}
                value={dueDateInputValue(task.due_date)}
                onChange={(event) => {
                  const value = event.target.value;
                  void run((token, id) =>
                    updateTask(token, id, {
                      due_date: value ? new Date(`${value}T12:00:00`).getTime() : null,
                      due_date_time: false,
                    }),
                  );
                }}
                className="w-40"
              />
            </dd>
            <dt className={FIELD_LABEL_CLASS}>
              <FlagIcon className="size-4" />
              Priority
            </dt>
            <dd>
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      disabled={!editable}
                      className="flex items-center gap-1 rounded-sm px-1 py-0.5 enabled:hover:bg-accent"
                    />
                  }
                >
                  <FlagIcon
                    className="size-3.5"
                    style={{ color: priority ? PRIORITY_COLORS[priority] : "#87909e" }}
                  />
                  {priority ? (PRIORITY_LABELS[priority] ?? "Priority") : "None"}
                </MenuTrigger>
                <MenuPopup align="start" side="bottom">
                  <MenuRadioGroup
                    value={priority ?? ""}
                    onValueChange={(value) =>
                      void run((token, id) =>
                        updateTask(token, id, { priority: value ? Number(value) : null }),
                      )
                    }
                  >
                    {PRIORITY_OPTIONS.map((value) => (
                      <MenuRadioItem key={value} value={value} closeOnClick>
                        <FlagIcon className="size-3.5" style={{ color: PRIORITY_COLORS[value] }} />
                        {PRIORITY_LABELS[value]}
                      </MenuRadioItem>
                    ))}
                    <MenuRadioItem value="" closeOnClick>
                      None
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </MenuPopup>
              </Menu>
            </dd>
            <dt className={FIELD_LABEL_CLASS}>
              <TagIcon className="size-4" />
              Tags
            </dt>
            <dd className="flex flex-wrap items-center gap-1">
              {taskTags.map((tag) => (
                <span
                  key={tag.name}
                  className="flex items-center gap-1 rounded-full bg-accent py-0.5 pr-0.5 pl-2 font-medium"
                  style={tag.tag_bg ? { backgroundColor: tag.tag_bg, color: tag.tag_fg } : {}}
                >
                  {tag.name}
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => void run((token, id) => setTaskTag(token, id, tag.name, false))}
                    aria-label={`Remove tag ${tag.name}`}
                    className="grid size-4 place-items-center rounded-xs enabled:hover:bg-black/10"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost-muted"
                      size="icon-micro"
                      disabled={!editable}
                      aria-label="Add tag"
                    />
                  }
                >
                  <PlusIcon />
                </MenuTrigger>
                <MenuPopup align="start" side="bottom">
                  {spaceTags.filter((tag) => !taskTags.some((entry) => entry.name === tag.name))
                    .length === 0 ? (
                    <MenuItem disabled>No more tags in this space</MenuItem>
                  ) : (
                    spaceTags
                      .filter((tag) => !taskTags.some((entry) => entry.name === tag.name))
                      .map((tag) => (
                        <MenuItem
                          key={tag.name}
                          onClick={() =>
                            void run((token, id) => setTaskTag(token, id, tag.name, true))
                          }
                        >
                          {tag.name}
                        </MenuItem>
                      ))
                  )}
                </MenuPopup>
              </Menu>
            </dd>
          </dl>

          {threads.length > 0 ? (
            <>
              <SectionTitle>Threads</SectionTitle>
              <ul className="space-y-1">
                {threads.map((thread) => (
                  <li key={`${thread.environmentId}:${thread.id}`}>
                    <Link
                      to="/$environmentId/$threadId"
                      params={{ environmentId: thread.environmentId, threadId: thread.id }}
                      onClick={onClose}
                      className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-accent"
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          threadIsRunning(thread) ? "bg-success" : "bg-muted-foreground/50",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                      <span className="text-2xs text-muted-foreground">
                        {threadIsRunning(thread) ? "Running" : "Idle"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="flex items-center">
            <SectionTitle>Description</SectionTitle>
            {descriptionDraft === null && editable ? (
              <Button
                variant="ghost-muted"
                size="micro"
                className="mt-6 ml-auto"
                onClick={() => setDescriptionDraft(description)}
              >
                <PencilIcon />
                Edit
              </Button>
            ) : null}
          </div>
          {loadError ? (
            <p className="text-xs text-error">{loadError}</p>
          ) : token && !loaded ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : descriptionDraft !== null ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                rows={10}
                aria-label="Description"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="xs" onClick={() => setDescriptionDraft(null)}>
                  Cancel
                </Button>
                <Button size="xs" disabled={saving} onClick={() => void saveDescription()}>
                  Save
                </Button>
              </div>
            </div>
          ) : description ? (
            <ChatMarkdown text={description} cwd={undefined} parseRawHtml={false} />
          ) : (
            <p className="text-xs text-muted-foreground">No description.</p>
          )}

          {loaded ? (
            <>
              <SectionTitle>Subtasks</SectionTitle>
              <ul className="rounded-md border border-border empty:hidden">
                {(loaded.subtasks ?? []).map((subtask) => (
                  <li
                    key={subtask.id}
                    className="flex h-9 items-center gap-2.5 border-b border-border px-3 last:border-b-0"
                  >
                    <span
                      className="size-3 shrink-0 rounded-full border-2"
                      style={{
                        borderColor: subtask.status?.color ?? STATUS_GROUP_FALLBACK_COLOR,
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{subtask.name}</span>
                    <span className="text-2xs text-muted-foreground uppercase">
                      {subtask.status?.status}
                    </span>
                  </li>
                ))}
              </ul>
              {editable || subtaskDraft ? (
                <Input
                  size="compact"
                  className="mt-2"
                  placeholder="Add subtask and press Enter"
                  value={subtaskDraft}
                  disabled={!editable}
                  onChange={(event) => setSubtaskDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addSubtask();
                  }}
                />
              ) : null}
            </>
          ) : null}

          {loaded?.checklists?.map((checklist) => (
            <div key={checklist.id}>
              <SectionTitle>{checklist.name}</SectionTitle>
              <ul className="space-y-1">
                {checklist.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={() =>
                        void run((token) =>
                          setChecklistItemResolved(token, checklist.id, item.id, !item.resolved),
                        )
                      }
                      className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left enabled:hover:bg-accent"
                    >
                      <CheckIcon
                        className={cn(
                          "size-3.5 shrink-0",
                          item.resolved ? "text-primary" : "text-muted-foreground/40",
                        )}
                      />
                      <span className={cn(item.resolved && "text-muted-foreground line-through")}>
                        {item.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <aside className="flex min-h-0 w-96 shrink-0 flex-col border-l border-border bg-muted/40 @max-3xl:w-full @max-3xl:border-t @max-3xl:border-l-0">
          <div className="flex h-11 shrink-0 items-center px-4 text-sm font-semibold">Activity</div>
          <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
            {loaded && comments.length === 0 ? (
              <li className="text-xs text-muted-foreground">No comments yet.</li>
            ) : null}
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-2 text-xs">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-4xs font-semibold text-primary-foreground">
                  {comment.user.username.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{comment.user.username}</span>
                    <span className="ml-auto text-2xs text-muted-foreground">
                      {new Date(Number(comment.date)).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{comment.comment_text}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
            <Textarea
              size="sm"
              placeholder="Write a comment…"
              value={commentDraft}
              disabled={!editable}
              onChange={(event) => setCommentDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void addComment();
              }}
              aria-label="Comment"
            />
            <Button
              size="xs"
              className="self-end"
              disabled={!editable || commentDraft.trim().length === 0}
              onClick={() => void addComment()}
            >
              Comment
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
