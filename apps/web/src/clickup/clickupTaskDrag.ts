import { Option, Schema } from "effect";

import type { ClickUpTask } from "./api";

export const CLICKUP_TASK_DRAG_TYPE = "application/x-t3code-clickup-task";

const DragPayload = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  status: Schema.String,
});
const DragPayloadJson = Schema.fromJsonString(DragPayload);
const encodeDragPayload = Schema.encodeSync(DragPayloadJson);
const decodeDragPayload = Schema.decodeUnknownOption(DragPayloadJson);

export function encodeClickUpTaskDragPayload(task: ClickUpTask): string {
  return encodeDragPayload({
    id: task.id,
    name: task.name,
    url: task.url,
    status: task.status.status,
  });
}

/** The summary a chip needs; the full ticket is reloaded from the ClickUp API on drop. */
export function decodeClickUpTaskDragPayload(payload: string): ClickUpTask | null {
  const decoded = decodeDragPayload(payload);
  if (Option.isNone(decoded)) return null;
  const { id, name, url, status } = decoded.value;
  return {
    id,
    name,
    url,
    status: { status, color: "" },
    priority: null,
    due_date: null,
    assignees: [],
  };
}

interface ClickUpTaskDragEvent {
  readonly dataTransfer: {
    readonly types: ReadonlyArray<string>;
    dropEffect: string;
    getData(format: string): string;
  };
  preventDefault(): void;
  stopPropagation(): void;
}

export function isClickUpTaskDrag(types: ReadonlyArray<string>): boolean {
  return types.includes(CLICKUP_TASK_DRAG_TYPE);
}

/** Claims a ticket dropped on a thread, or returns null for every other drag. */
export function readClickUpTaskDrop(event: ClickUpTaskDragEvent): ClickUpTask | null {
  if (!isClickUpTaskDrag(event.dataTransfer.types)) return null;
  event.preventDefault();
  event.stopPropagation();
  return decodeClickUpTaskDragPayload(event.dataTransfer.getData(CLICKUP_TASK_DRAG_TYPE));
}
