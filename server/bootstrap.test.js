import assert from "node:assert/strict";
import test from "node:test";
import { accounts } from "../src/db/schema.js";
import { bootstrapApplication } from "./bootstrap.js";

test("the reserved administrator is upgraded to the protected Super User role", async () => {
  const updates = [];
  const db = {
    select() {
      return {
        from() { return this; },
        innerJoin() { return this; },
        where() { return this; },
        async limit() {
          return [{ accountId: 7, role: "admin" }];
        },
      };
    },
    update(table) {
      return {
        set(values) {
          return {
            async where() {
              updates.push({ table, values });
            },
          };
        },
      };
    },
  };

  await bootstrapApplication({ db });

  assert.deepEqual(updates.find(({ table }) => table === accounts), {
    table: accounts,
    values: { accountRole: "super_admin" },
  });
});
