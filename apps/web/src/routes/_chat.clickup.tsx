import { createFileRoute } from "@tanstack/react-router";

import { ClickUpPage } from "../clickup/ClickUpPage";

export const Route = createFileRoute("/_chat/clickup")({
  component: ClickUpPage,
});
