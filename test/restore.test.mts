import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBackup, planRestore } from "../src/lib/restore-core.ts";

const OLD = "2026-09-01T09:00:00.000Z";
const NEW = "2026-09-01T10:00:00.000Z";

const backupOf = (namespaces: Record<string, unknown>) => ({ source: "server", exportedAt: NEW, namespaces });

test("parseBackup rejects anything that is not a backup file", () => {
  assert.equal(parseBackup(null).ok, false);
  assert.equal(parseBackup([]).ok, false);
  assert.equal(parseBackup({ hello: 1 }).ok, false);
  assert.equal(parseBackup({ namespaces: "nope" }).ok, false);
  assert.equal(parseBackup({ namespaces: { "not-a-namespace": {} } }).ok, false, "no known namespace means nothing to restore");
});

test("parseBackup keeps known namespaces, drops nulls, reports unknown keys", () => {
  const r = parseBackup({ source: "local", exportedAt: OLD, namespaces: { "omi-people": { a: {} }, "omi-places": null, mystery: {} } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.backup.namespaces), ["omi-people"]);
  assert.deepEqual(r.ignored, ["mystery"]);
  assert.equal(r.backup.source, "local");
});

test("a restore adds what the device lacks and leaves the rest alone", () => {
  const plan = planRestore(
    backupOf({ "omi-people": { a: { timestamp: OLD, name: "A" }, b: { timestamp: OLD, name: "B" } } }),
    { "omi-people": { a: { timestamp: OLD, name: "A" } } }
  );
  const p = plan.namespaces[0];
  assert.equal(p.added, 1);
  assert.equal(p.updated, 0);
  assert.deepEqual(Object.keys(p.merged as object).sort(), ["a", "b"]);
  assert.equal(plan.changed, true);
});

test("the device's newer record wins; the backup's newer record wins; a tie keeps the device", () => {
  const plan = planRestore(
    backupOf({
      "omi-people": {
        stale: { timestamp: OLD, name: "backup" },
        fresh: { timestamp: NEW, name: "backup" },
        tie: { timestamp: OLD, name: "backup" },
      },
    }),
    {
      "omi-people": {
        stale: { timestamp: NEW, name: "device" },
        fresh: { timestamp: OLD, name: "device" },
        tie: { timestamp: OLD, name: "device" },
      },
    }
  );
  const merged = plan.namespaces[0].merged as Record<string, { name: string }>;
  assert.equal(merged.stale.name, "device");
  assert.equal(merged.fresh.name, "backup");
  assert.equal(merged.tie.name, "device");
  assert.equal(plan.updated, 1);
});

test("a newer tombstone in the backup counts as a deletion and is applied", () => {
  const plan = planRestore(
    backupOf({ "omi-people": { a: { deleted: true, timestamp: NEW } } }),
    { "omi-people": { a: { timestamp: OLD, name: "A" } } }
  );
  assert.equal(plan.deletions, 1);
  assert.equal(plan.added, 0);
  assert.equal((plan.namespaces[0].merged as Record<string, { deleted?: boolean }>).a.deleted, true);
});

test("an older tombstone does not delete a record the device updated since", () => {
  const plan = planRestore(
    backupOf({ "omi-people": { a: { deleted: true, timestamp: OLD } } }),
    { "omi-people": { a: { timestamp: NEW, name: "A" } } }
  );
  assert.equal(plan.deletions, 0);
  assert.equal(plan.changed, false);
});

test("array namespaces are accepted bare (both export shapes) and merged by id", () => {
  const device = { "omi-thesis-analyses": [{ conversationId: "c1", current: { timestamp: OLD, title: "d" } }] };
  const bare = planRestore(backupOf({ "omi-thesis-analyses": [{ conversationId: "c2", current: { timestamp: OLD } }] }), device);
  assert.equal(bare.added, 1);
  assert.equal((bare.namespaces[0].merged as unknown[]).length, 2);
  assert.ok(Array.isArray(bare.namespaces[0].merged), "written back as a bare array, the client shape");
  const wrapped = planRestore(backupOf({ "omi-thesis-analyses": { list: [{ conversationId: "c2", current: { timestamp: OLD } }] } }), device);
  assert.equal(wrapped.added, 1);
});

test("a backup identical to the device changes nothing", () => {
  const value = { a: { timestamp: OLD, name: "A" } };
  const plan = planRestore(backupOf({ "omi-people": value }), { "omi-people": value });
  assert.equal(plan.changed, false);
  assert.equal(plan.added + plan.updated + plan.deletions, 0);
});

test("a namespace missing from the device is filled from the backup", () => {
  const plan = planRestore(backupOf({ "omi-places": { p1: { timestamp: OLD, name: "Dry Fork" } } }), {});
  assert.equal(plan.added, 1);
  assert.deepEqual(plan.namespaces[0].merged, { p1: { timestamp: OLD, name: "Dry Fork" } });
});
