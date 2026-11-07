// @effect-diagnostics nodeBuiltinImport:off -- Persistence tests exercise the real SQLite adapter and temporary attachment files.
// @effect-diagnostics globalDate:off -- Fixed ISO instants test calendar boundaries without wall-clock waits.
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeFSP from "node:fs/promises";
import { expect, it } from "@effect/vitest";

import { openLifeStore, isQuietTime } from "./store.ts";
import type { LifeRecord } from "@t3tools/contracts/life";

async function fixture() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "j3-life-store-"));
  const store = await openLifeStore(directory);
  return {
    store,
    directory,
    async [Symbol.asyncDispose]() {
      store.close();
      await NodeFSP.rm(directory, { recursive: true, force: true });
    },
  };
}

it("persists captures before processing, deduplicates retries, and searches after reopening", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "j3-life-durable-"));
  let store = await openLifeStore(directory);
  try {
    const input = {
      requestId: "capture-1",
      action: {
        type: "capture" as const,
        title: "Arabic lesson notes",
        text: "Practiced reading today",
        files: [
          {
            name: "lesson.txt",
            mime: "text/plain",
            base64: Buffer.from("Today I practiced Arabic").toString("base64"),
          },
        ],
      },
    };
    const first = await store.write(input);
    expect(await store.write(input)).toEqual(first);
    await expect(
      store.write({ ...input, action: { ...input.action, title: "Different" } }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect((await store.snapshot()).records).toHaveLength(1);
    const processing = await store.setProcessing(first.id);
    expect(processing.status).toBe("processing");
    store.close();
    store = await openLifeStore(directory);
    const capture = (await store.snapshot({ query: "Arabic" })).records[0]!;
    expect(capture.status).toBe("failed");
    expect(capture.error).toContain("interrupted");
    expect(await store.asset(capture.attachmentIds[0]!)).toEqual(input.action.files[0]);
    await expect(store.asset("../../private")).rejects.toMatchObject({ code: "invalid" });
  } finally {
    store.close();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});

it("rejects stale edits and undoes only the version a change wrote", async () => {
  await using f = await fixture();
  const added = await f.store.write({
    requestId: "add-task",
    action: { type: "save", record: { kind: "task", title: "Read a chapter" } },
  });
  const original = (await f.store.snapshot({ id: added.id })).records[0]!;
  const update = await f.store.write({
    requestId: "done-task",
    action: {
      type: "save",
      record: {
        id: original.id,
        kind: original.kind,
        title: original.title,
        expectedRevision: original.revision,
        status: "done",
      },
    },
  });
  await expect(
    f.store.write({
      requestId: "stale-task",
      action: { type: "save", record: { ...original, expectedRevision: original.revision } },
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    f.store.write({ requestId: "undo-old", action: { type: "undo", changeId: added.changeId! } }),
  ).rejects.toMatchObject({ code: "conflict" });
  await f.store.write({
    requestId: "undo-new",
    action: { type: "undo", changeId: update.changeId! },
  });
  expect((await f.store.snapshot({ id: original.id })).records[0]!.status).toBe("open");
});

it("organizes a capture atomically with evidence, course progress and undo", async () => {
  await using f = await fixture();
  const course = await f.store.write({
    requestId: "course",
    action: { type: "save", record: { kind: "course", title: "Learn Arabic" } },
  });
  const capture = await f.store.write({
    requestId: "capture",
    action: {
      type: "capture",
      title: "Completed lesson",
      text: "Finished the alphabet",
      files: [],
    },
  });
  const processing = await f.store.setProcessing(capture.id);
  await expect(
    f.store.applyOrganization(capture.id, processing.revision, [
      { kind: "lesson", title: "Broken parent", parentId: "missing" },
    ]),
  ).rejects.toMatchObject({ code: "invalid" });
  expect((await f.store.snapshot()).records).toHaveLength(2);
  const changeId = await f.store.applyOrganization(capture.id, processing.revision, [
    { kind: "lesson", title: "Alphabet", parentId: course.id, status: "done" },
  ]);
  const state = await f.store.snapshot();
  const lesson = state.records.find((record) => record.kind === "lesson")!;
  expect(lesson.relatedIds).toContain(capture.id);
  expect(state.records.find((record) => record.id === capture.id)?.status).toBe("completed");
  expect(state.records.find((record) => record.id === course.id)?.progress).toBe(100);
  await f.store.write({ requestId: "undo-organization", action: { type: "undo", changeId } });
  expect((await f.store.snapshot({ id: lesson.id })).records[0]?.status).toBe("archived");
  expect((await f.store.snapshot({ id: course.id })).records[0]?.progress).toBe(0);
});

it("round-trips records, history and attachment bytes, rejecting corrupt restores before mutation", async () => {
  await using source = await fixture();
  await using destination = await fixture();
  await source.store.write({
    requestId: "photo",
    action: {
      type: "capture",
      title: "Evidence",
      text: "",
      files: [
        {
          name: "proof.png",
          mime: "image/png",
          base64: Buffer.from([137, 80, 78, 71]).toString("base64"),
        },
      ],
    },
  });
  const backup = await source.store.backup();
  const corrupt = {
    ...backup,
    files: backup.files.map((item) => ({ ...item, file: { ...item.file, base64: "AAAA" } })),
  };
  await expect(destination.store.restore(corrupt)).rejects.toMatchObject({ code: "invalid" });
  expect((await destination.store.snapshot()).records).toHaveLength(0);
  await destination.store.restore(backup);
  expect(await destination.store.backup()).toMatchObject({
    snapshot: backup.snapshot,
    files: backup.files,
  });
  expect(
    await NodeFSP.readFile(
      NodePath.join(destination.directory, "attachments", backup.files[0]!.id),
    ),
  ).toEqual(Buffer.from([137, 80, 78, 71]));
});

it("persists reminder claims and applies quiet hours across midnight in the configured time zone", async () => {
  await using f = await fixture();
  const reminder = await f.store.write({
    requestId: "reminder",
    action: {
      type: "save",
      record: {
        kind: "reminder",
        title: "Come back to the lesson",
        dueAt: "2026-11-07T08:00:00.000Z",
      },
    },
  });
  const now = new Date("2026-11-07T10:00:00.000Z");
  const due = await f.store.due(now);
  expect(due.map((record) => record.id)).toEqual([reminder.id]);
  await f.store.markDelivered(due[0] as LifeRecord);
  expect(await f.store.due(now)).toHaveLength(0);
  expect(
    isQuietTime(new Date("2026-11-07T23:00:00.000Z"), {
      quietStart: "22:00",
      quietEnd: "08:00",
      timeZone: "UTC",
    }),
  ).toBe(true);
  expect(
    isQuietTime(new Date("2026-11-08T07:59:00.000Z"), {
      quietStart: "22:00",
      quietEnd: "08:00",
      timeZone: "UTC",
    }),
  ).toBe(true);
  expect(
    isQuietTime(new Date("2026-11-08T08:00:00.000Z"), {
      quietStart: "22:00",
      quietEnd: "08:00",
      timeZone: "UTC",
    }),
  ).toBe(false);
});
