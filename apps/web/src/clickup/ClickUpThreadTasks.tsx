import type { OrchestrationMessageContext, ScopedThreadRef } from "@t3tools/contracts";

import { ThreadDetailsSection } from "../components/chat/ThreadDetailsSection";
import {
  mentionedClickUpTasks,
  openClickUpTaskInRightPanel,
  useClickUpTaskStatuses,
} from "./clickupTaskMentions";

const UNKNOWN_STATUS_COLOR = "#87909e";

/** The ClickUp tasks a thread mentions, with their live status. */
export function ClickUpThreadTasks(props: {
  threadRef: ScopedThreadRef;
  messages: ReadonlyArray<{ readonly context?: OrchestrationMessageContext | undefined }>;
}) {
  const tasks = mentionedClickUpTasks(props.messages);
  const live = useClickUpTaskStatuses(tasks.map((task) => task.id));
  const { threadRef } = props;
  if (tasks.length === 0) return null;
  return (
    <ThreadDetailsSection headingId="thread-details-clickup-heading" title="ClickUp tasks">
      <div className="flex flex-col">
        {tasks.map((task) => {
          const status = live.get(task.id);
          const statusLabel = status?.status ?? task.status;
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => openClickUpTaskInRightPanel(threadRef, task.id)}
              className="flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-xs hover:bg-accent"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: status?.color ?? UNKNOWN_STATUS_COLOR }}
              />
              <span className="min-w-0 flex-1 truncate">{task.name}</span>
              {statusLabel ? (
                <span className="shrink-0 text-2xs font-medium text-muted-foreground uppercase">
                  {statusLabel}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </ThreadDetailsSection>
  );
}
