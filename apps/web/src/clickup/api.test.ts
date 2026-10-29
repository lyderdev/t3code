import { expect, it, vi } from "vite-plus/test";

import {
  readClickUpAccounts,
  readClickUpToken,
  removeClickUpAccount,
  saveClickUpAccount,
} from "./api";

function setup(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
  return store;
}

it("migrates the legacy single token and keeps the active account first", () => {
  const store = setup({ "ldcode:clickup:token": " pk_old " });
  expect(readClickUpAccounts()).toEqual([{ token: "pk_old", email: "" }]);

  saveClickUpAccount({ token: "pk_new", email: "new@x.dev" });
  expect(store.has("ldcode:clickup:token")).toBe(false);
  expect(readClickUpToken()).toBe("pk_new");

  saveClickUpAccount({ token: "pk_old", email: "old@x.dev" });
  expect(readClickUpAccounts().map((account) => account.email)).toEqual(["old@x.dev", "new@x.dev"]);

  removeClickUpAccount("pk_old");
  expect(readClickUpToken()).toBe("pk_new");
  removeClickUpAccount("pk_new");
  expect(readClickUpToken()).toBeNull();
});
