import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Every connected ClickUp token, active account first; empty clears them. */
export const ClickUpSetTokensInput = Schema.Struct({
  tokens: Schema.Array(TrimmedNonEmptyString),
});
export type ClickUpSetTokensInput = typeof ClickUpSetTokensInput.Type;

export class ClickUpError extends Schema.TaggedError<ClickUpError>()("ClickUpError", {
  message: Schema.String,
}) {}
