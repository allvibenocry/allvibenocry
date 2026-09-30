// Two restore contexts never share a folder (D82): going back with the data
// decrypts the backup it restores, then restore-checks a fresh one, both within
// a second; with one folder, the fresh copy replaced the one to be restored.
import assert from "node:assert/strict";
import { test } from "node:test";
import { newRestoreContext } from "../../dist/lib/backup.js";

test("two restore contexts made at once have folders and copies of their own", () => {
  const project = { name: "hello" };
  const a = newRestoreContext(project);
  const b = newRestoreContext(project);
  assert.notEqual(a.work, b.work);
  assert.notEqual(a.decrypted, b.decrypted);
  assert.ok(a.decrypted.startsWith(a.work) && b.decrypted.startsWith(b.work));
  assert.match(a.work, /restore-hello-\d{8}T\d{6}Z-[0-9a-f]{8}$/);
});
