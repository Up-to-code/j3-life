// @effect-diagnostics globalDate:off -- This imperative SQLite adapter persists ISO dates and accepts explicit dates for reminder decisions.
// @effect-diagnostics nodeBuiltinImport:off -- This persistence adapter owns SQLite and immutable attachment files.
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodeSqlite from "node:sqlite";

import * as Schema from "effect/Schema";
import {
  LifeBackup,
  LifeError,
  LifeRecord,
  LifeSettings,
  LifeWriteInput,
  type LifeAttachment,
  type LifeChange,
  type LifeFile,
  type LifeReadInput,
  type LifeRecordInput,
  type LifeSnapshot,
  type LifeWriteResult,
} from "@t3tools/contracts/life";

const decodeRecord = Schema.decodeUnknownSync(LifeRecord);
const decodeSettings = Schema.decodeUnknownSync(LifeSettings);
const decodeWrite = Schema.decodeUnknownSync(LifeWriteInput);
const decodeBackup = Schema.decodeUnknownSync(LifeBackup);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const defaults: LifeSettings = {
  focusIds: [],
  quietStart: "22:00",
  quietEnd: "08:00",
  timeZone: "Africa/Cairo",
  model: null,
};
const invalid = (message: string) => new LifeError({ code: "invalid", message });
const conflict = () =>
  new LifeError({
    code: "conflict",
    message: "This record changed on another device. Refresh before saving.",
  });
const parseRecord = (value: unknown) => decodeRecord(JSON.parse(String(value)));
const digest = (bytes: Uint8Array | string) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("hex");

export async function openLifeStore(directory: string) {
  await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  const attachmentDir = NodePath.join(directory, "attachments");
  await NodeFSP.mkdir(attachmentDir, { recursive: true, mode: 0o700 });
  const db = new NodeSqlite.DatabaseSync(NodePath.join(directory, "life.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS life_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(id UNINDEXED, title, body);
    CREATE TABLE IF NOT EXISTS changes(id TEXT PRIMARY KEY, at TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY, body TEXT NOT NULL);
    INSERT OR IGNORE INTO life_migrations VALUES(1);`);
  db.prepare("INSERT OR IGNORE INTO settings VALUES(1, ?)").run(JSON.stringify(defaults));
  let queue = Promise.resolve();
  const serial = <A>(operation: () => Promise<A> | A): Promise<A> => {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const transaction = <A>(operation: () => A): A => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const get = (id: string): LifeRecord | null => {
    const row = db.prepare("SELECT body FROM records WHERE id=?").get(id);
    return row ? parseRecord(row.body) : null;
  };
  const settings = () =>
    decodeSettings(
      JSON.parse(String(db.prepare("SELECT body FROM settings WHERE id=1").get()!.body)),
    );
  const all = () =>
    db
      .prepare("SELECT body FROM records ORDER BY rowid DESC")
      .all()
      .map((row) => parseRecord(row.body));
  const put = (record: LifeRecord) => {
    db.prepare(
      "INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, body=excluded.body",
    ).run(record.id, record.kind, JSON.stringify(record));
    db.prepare("DELETE FROM records_fts WHERE id=?").run(record.id);
    db.prepare("INSERT INTO records_fts VALUES(?,?,?)").run(record.id, record.title, record.body);
  };
  const change = (label: string, before: readonly LifeRecord[], after: readonly LifeRecord[]) => {
    const result: LifeChange = {
      id: NodeCrypto.randomUUID(),
      label,
      at: new Date().toISOString(),
      before,
      after,
      undone: false,
    };
    db.prepare("INSERT INTO changes VALUES(?,?,?)").run(
      result.id,
      result.at,
      JSON.stringify(result),
    );
    return result.id;
  };
  const saveRecord = (input: LifeRecordInput) => {
    const old = input.id ? get(input.id) : null;
    if (input.id && !old)
      throw new LifeError({ code: "not_found", message: "Record no longer exists." });
    if (old && input.expectedRevision !== old.revision) throw conflict();
    if (old && old.kind !== input.kind) throw invalid("A record's kind cannot change.");
    if (input.sourceUrl && !/^https?:\/\//i.test(input.sourceUrl))
      throw invalid("Course links must use HTTPS or HTTP.");
    if (input.dueAt && !Number.isFinite(Date.parse(input.dueAt)))
      throw invalid("Choose a valid reminder date.");
    const now = new Date().toISOString();
    const record = decodeRecord({
      id: old?.id ?? NodeCrypto.randomUUID(),
      kind: input.kind,
      title: input.title.trim(),
      body: "",
      status: "open",
      parentId: null,
      relatedIds: [],
      date: null,
      dueAt: null,
      nextSteps: [],
      progress: 0,
      sourceUrl: null,
      attachmentIds: [],
      error: null,
      createdAt: now,
      ...old,
      ...Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== "expectedRevision" && key !== "id"),
      ),
      revision: (old?.revision ?? 0) + 1,
      updatedAt: now,
    });
    if (record.parentId === record.id || record.relatedIds.includes(record.id))
      throw invalid("A record cannot link to itself.");
    for (const id of [record.parentId, ...record.relatedIds].filter(
      (id): id is string => id !== null,
    )) {
      if (!get(id)) throw invalid("A linked record no longer exists.");
    }
    if (record.kind === "lesson" && (!record.parentId || get(record.parentId)?.kind !== "course"))
      throw invalid("Choose a course for this lesson.");
    for (const id of record.attachmentIds) {
      if (!db.prepare("SELECT id FROM attachments WHERE id=?").get(id))
        throw invalid("An attachment is missing.");
    }
    put(record);
    return { record, old };
  };
  const courseProgress = (courseId: string | null) => {
    if (!courseId) return null;
    const course = get(courseId);
    if (!course || course.kind !== "course") return null;
    const lessons = all().filter(
      (record) =>
        record.kind === "lesson" && record.parentId === courseId && record.status !== "archived",
    );
    if (!lessons.length) return null;
    const progress = Math.round(
      (lessons.filter((lesson) => lesson.status === "done").length * 100) / lessons.length,
    );
    if (progress === course.progress) return null;
    const updated = {
      ...course,
      progress,
      revision: course.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    put(updated);
    return { before: course, after: updated };
  };
  const snapshot = (input: LifeReadInput = {}): LifeSnapshot => {
    let records: LifeRecord[];
    if (input.query?.trim()) {
      const query = input.query
        .trim()
        .split(/\s+/)
        .map((word) => `"${word.replaceAll('"', '""')}"*`)
        .join(" AND ");
      records = db
        .prepare(
          "SELECT r.body FROM records r JOIN records_fts f ON f.id=r.id WHERE records_fts MATCH ? ORDER BY rank LIMIT 500",
        )
        .all(query)
        .map((row) => parseRecord(row.body));
    } else
      records = input.id
        ? [get(input.id)].filter((record): record is LifeRecord => record !== null)
        : all();
    if (input.kind) records = records.filter((record) => record.kind === input.kind);
    if (input.id) records = records.filter((record) => record.id === input.id);
    return {
      records: records.slice(0, 500),
      settings: settings(),
      changes: db
        .prepare("SELECT body FROM changes ORDER BY rowid DESC LIMIT 30")
        .all()
        .map((row) => JSON.parse(String(row.body)) as LifeChange),
      attachments: db
        .prepare("SELECT body FROM attachments")
        .all()
        .map((row) => JSON.parse(String(row.body)) as LifeAttachment),
    };
  };
  const fileBytes = (file: LifeFile) => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))
      throw invalid("The uploaded file is incomplete.");
    const bytes = Buffer.from(file.base64, "base64");
    if (bytes.byteLength > MAX_FILE_BYTES) throw invalid("Each file must be 8 MB or smaller.");
    return bytes;
  };
  const persistFile = async (file: LifeFile) => {
    const bytes = fileBytes(file);
    const id = digest(bytes);
    const path = NodePath.join(attachmentDir, id);
    try {
      await NodeFSP.writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (!(await NodeFSP.lstat(path)).isFile() || digest(await NodeFSP.readFile(path)) !== id)
        throw invalid("The attachment store needs repair.");
    }
    return {
      id,
      name: file.name,
      mime: file.mime,
      size: bytes.byteLength,
    } satisfies LifeAttachment;
  };
  const asset = async (id: string): Promise<LifeFile> => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw invalid("Invalid attachment.");
    const row = db.prepare("SELECT body FROM attachments WHERE id=?").get(id);
    if (!row) throw new LifeError({ code: "not_found", message: "Attachment not found." });
    const metadata = JSON.parse(String(row.body)) as LifeAttachment;
    const path = NodePath.join(attachmentDir, id);
    if (!(await NodeFSP.lstat(path)).isFile()) throw invalid("Invalid attachment file.");
    const bytes = await NodeFSP.readFile(path);
    if (bytes.byteLength > MAX_FILE_BYTES || digest(bytes) !== id)
      throw invalid("Attachment failed its integrity check.");
    return { name: metadata.name, mime: metadata.mime, base64: bytes.toString("base64") };
  };
  const exportBackup = async (): Promise<LifeBackup> => {
    const state: LifeSnapshot = {
      ...snapshot(),
      records: all(),
      changes: db
        .prepare("SELECT body FROM changes ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(String(row.body)) as LifeChange),
    };
    if (state.attachments.reduce((sum, file) => sum + file.size * 1.34, 0) > MAX_BACKUP_BYTES)
      throw invalid(
        "Backup exceeds 64 MB. Copy the personal data folder while J3 Life is stopped.",
      );
    const files = [];
    for (const attachment of state.attachments)
      files.push({ id: attachment.id, file: await asset(attachment.id) });
    const result: LifeBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      snapshot: state,
      files,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_BACKUP_BYTES)
      throw invalid("Backup exceeds 64 MB.");
    return result;
  };
  const write = async (raw: LifeWriteInput): Promise<LifeWriteResult> =>
    serial(async () => {
      const input = decodeWrite(raw);
      const hash = digest(JSON.stringify(input.action));
      const receipt = db
        .prepare("SELECT hash,result FROM receipts WHERE id=?")
        .get(input.requestId);
      if (receipt) {
        if (receipt.hash !== hash)
          throw invalid("This retry key was already used for another change.");
        return JSON.parse(String(receipt.result)) as LifeWriteResult;
      }
      const files: LifeAttachment[] = [];
      if (input.action.type === "capture") {
        if (input.action.files.reduce((sum, file) => sum + file.base64.length, 0) > 12_000_000)
          throw invalid("A capture must be 8 MB or smaller in total.");
        for (const file of input.action.files) files.push(await persistFile(file));
      }
      return transaction(() => {
        const action = input.action;
        let result: LifeWriteResult;
        if (action.type === "settings") {
          try {
            new Intl.DateTimeFormat("en", { timeZone: action.settings.timeZone }).resolvedOptions();
          } catch {
            throw invalid("Choose a valid time zone.");
          }
          if (
            new Set(action.settings.focusIds).size !== action.settings.focusIds.length ||
            action.settings.focusIds.some((id) => get(id)?.kind !== "task")
          )
            throw invalid("Choose up to three different tasks.");
          db.prepare("UPDATE settings SET body=? WHERE id=1").run(JSON.stringify(action.settings));
          result = { id: input.requestId, changeId: null };
        } else if (action.type === "undo") {
          const row = db.prepare("SELECT body FROM changes WHERE id=?").get(action.changeId);
          if (!row) throw new LifeError({ code: "not_found", message: "Change not found." });
          const entry = JSON.parse(String(row.body)) as LifeChange;
          if (
            entry.undone ||
            entry.after.some((record) => JSON.stringify(get(record.id)) !== JSON.stringify(record))
          )
            throw conflict();
          const restored: LifeRecord[] = [];
          for (const after of entry.after) {
            const before = entry.before.find((record) => record.id === after.id);
            const record: LifeRecord = {
              ...(before ?? after),
              ...(before ? {} : { status: "archived" }),
              revision: after.revision + 1,
              updatedAt: new Date().toISOString(),
            };
            put(record);
            restored.push(record);
          }
          db.prepare("UPDATE changes SET body=? WHERE id=?").run(
            JSON.stringify({ ...entry, undone: true }),
            entry.id,
          );
          result = {
            id: entry.after[0]?.id ?? input.requestId,
            changeId: change(`Undo: ${entry.label}`, entry.after, restored),
          };
        } else {
          for (const file of files)
            db.prepare("INSERT OR IGNORE INTO attachments VALUES(?,?)").run(
              file.id,
              JSON.stringify(file),
            );
          const { record, old } = saveRecord(
            action.type === "save"
              ? action.record
              : {
                  kind: "capture",
                  title: action.title,
                  body: action.text,
                  status: "pending",
                  attachmentIds: [...new Set(files.map((file) => file.id))],
                },
          );
          const before = old ? [old] : [];
          const after = [record];
          if (record.kind === "lesson")
            for (const id of new Set([record.parentId, old?.parentId ?? null])) {
              const course = courseProgress(id);
              if (course) {
                before.push(course.before);
                after.push(course.after);
              }
            }
          if (
            record.kind === "task" &&
            (record.status === "done" || record.status === "archived")
          ) {
            const current = settings();
            db.prepare("UPDATE settings SET body=? WHERE id=1").run(
              JSON.stringify({
                ...current,
                focusIds: current.focusIds.filter((id) => id !== record.id),
              }),
            );
          }
          result = {
            id: record.id,
            changeId: change(
              old ? `Updated ${record.title}` : `Added ${record.title}`,
              before,
              after,
            ),
          };
        }
        db.prepare("INSERT INTO receipts VALUES(?,?,?)").run(
          input.requestId,
          hash,
          JSON.stringify(result),
        );
        return result;
      });
    });
  const restore = (raw: LifeBackup) =>
    serial(async () => {
      if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BACKUP_BYTES)
        throw invalid("Backup exceeds 64 MB.");
      const backup = decodeBackup(raw);
      if (all().some((record) => record.status === "processing")) throw conflict();
      const ids = new Set(backup.snapshot.records.map((record) => record.id));
      if (ids.size !== backup.snapshot.records.length)
        throw invalid("Backup contains duplicate records.");
      const fileIds = new Set(backup.files.map((file) => file.id));
      if (
        fileIds.size !== backup.files.length ||
        backup.snapshot.attachments.some((file) => !fileIds.has(file.id))
      )
        throw invalid("Backup is missing attachments.");
      for (const record of backup.snapshot.records) {
        decodeRecord(record);
        if (
          (record.parentId && !ids.has(record.parentId)) ||
          record.relatedIds.some((id) => !ids.has(id)) ||
          record.attachmentIds.some((id) => !fileIds.has(id))
        )
          throw invalid("Backup contains broken record links.");
      }
      if (backup.snapshot.settings.focusIds.some((id) => !ids.has(id)))
        throw invalid("Backup has missing focus tasks.");
      for (const item of backup.files)
        if (digest(fileBytes(item.file)) !== item.id)
          throw invalid("Backup attachment failed its integrity check.");
      const previous = await exportBackup();
      await NodeFSP.mkdir(NodePath.join(directory, "backups"), { recursive: true, mode: 0o700 });
      await NodeFSP.writeFile(
        NodePath.join(directory, "backups", `${NodeCrypto.randomUUID()}.json`),
        JSON.stringify(previous),
        { flag: "wx", mode: 0o600 },
      );
      for (const item of backup.files) await persistFile(item.file);
      transaction(() => {
        db.exec(
          "DELETE FROM records; DELETE FROM records_fts; DELETE FROM changes; DELETE FROM receipts; DELETE FROM attachments; DELETE FROM deliveries;",
        );
        for (const record of backup.snapshot.records)
          put(
            record.kind === "capture" && record.status === "processing"
              ? {
                  ...record,
                  status: "failed",
                  error: "This backup contained interrupted processing. Retry organization.",
                  revision: record.revision + 1,
                }
              : record,
          );
        for (const entry of backup.snapshot.changes)
          db.prepare("INSERT INTO changes VALUES(?,?,?)").run(
            entry.id,
            entry.at,
            JSON.stringify(entry),
          );
        for (const file of backup.snapshot.attachments)
          db.prepare("INSERT INTO attachments VALUES(?,?)").run(file.id, JSON.stringify(file));
        db.prepare("UPDATE settings SET body=? WHERE id=1").run(
          JSON.stringify(backup.snapshot.settings),
        );
      });
    });
  const applyOrganization = (
    captureId: string,
    expectedRevision: number,
    proposals: readonly LifeRecordInput[],
  ) =>
    serial(() =>
      transaction(() => {
        const capture = get(captureId);
        if (!capture || capture.revision !== expectedRevision || capture.status !== "processing")
          throw conflict();
        const before: LifeRecord[] = [capture];
        const after: LifeRecord[] = [];
        const proposalIds = proposals.flatMap((proposal) => (proposal.id ? [proposal.id] : []));
        if (new Set(proposalIds).size !== proposalIds.length)
          throw invalid(
            "The model proposed multiple updates to the same record. Retry organization.",
          );
        for (const proposal of proposals.slice(0, 10)) {
          if (proposal.kind === "capture")
            throw invalid("An organizer cannot create another capture.");
          const { record, old } = saveRecord({
            ...proposal,
            relatedIds: [...new Set([...(proposal.relatedIds ?? []), captureId])],
            attachmentIds: [
              ...new Set([...(proposal.attachmentIds ?? []), ...capture.attachmentIds]),
            ],
          });
          if (old) before.push(old);
          after.push(record);
        }
        for (const courseId of new Set(
          after.filter((record) => record.kind === "lesson").map((record) => record.parentId),
        )) {
          const course = courseProgress(courseId);
          if (course) {
            if (!before.some((record) => record.id === courseId)) before.push(course.before);
            const index = after.findIndex((record) => record.id === courseId);
            if (index >= 0) after[index] = course.after;
            else after.push(course.after);
          }
        }
        const completed: LifeRecord = {
          ...capture,
          status: "completed",
          revision: capture.revision + 1,
          updatedAt: new Date().toISOString(),
          error: null,
        };
        put(completed);
        after.push(completed);
        return change(`Organized ${capture.title}`, before, after);
      }),
    );
  const setProcessing = (id: string, error: string | null = null, expectedRevision?: number) =>
    serial(() =>
      transaction(() => {
        const record = get(id);
        if (!record || record.kind !== "capture") throw invalid("Choose an inbox capture.");
        if (
          error &&
          expectedRevision !== undefined &&
          (record.revision !== expectedRevision || record.status !== "processing")
        )
          return record;
        if (
          !error &&
          (record.status === "processing" ||
            record.status === "completed" ||
            record.status === "archived")
        )
          throw conflict();
        const updated: LifeRecord = {
          ...record,
          status: error ? "failed" : "processing",
          error,
          revision: record.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        put(updated);
        return updated;
      }),
    );
  // A lost provider process cannot resume; keep the capture available for an explicit retry.
  transaction(() => {
    for (const record of all())
      if (record.kind === "capture" && record.status === "processing")
        put({
          ...record,
          status: "failed",
          error: "Processing was interrupted. Choose a model and retry.",
          revision: record.revision + 1,
          updatedAt: new Date().toISOString(),
        });
  });
  return {
    snapshot: (input: LifeReadInput = {}) => serial(() => snapshot(input)),
    write,
    asset: (id: string) => serial(() => asset(id)),
    backup: () => serial(exportBackup),
    restore,
    applyOrganization,
    setProcessing,
    settings: () => serial(settings),
    due: (now: Date) =>
      serial(() => {
        if (isQuietTime(now, settings())) return [];
        const due = all().filter(
          (record) =>
            (record.kind === "task" || record.kind === "reminder") &&
            record.dueAt &&
            Date.parse(record.dueAt) <= now.getTime() &&
            record.status === "open",
        );
        return due.filter(
          (record) =>
            !db.prepare("SELECT id FROM deliveries WHERE id=?").get(`${record.id}:${record.dueAt}`),
        );
      }),
    markDelivered: (record: LifeRecord) =>
      serial(() => {
        db.prepare("INSERT OR IGNORE INTO deliveries VALUES(?,?)").run(
          `${record.id}:${record.dueAt}`,
          JSON.stringify({ at: new Date().toISOString() }),
        );
      }),
    subscribe: (id: string, subscription: unknown) =>
      serial(() => {
        if (subscription === null) db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(id);
        else
          db.prepare(
            "INSERT INTO push_subscriptions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
          ).run(id, JSON.stringify(subscription));
      }),
    subscriptions: () =>
      serial(() =>
        db
          .prepare("SELECT id,body FROM push_subscriptions")
          .all()
          .map((row) => ({
            id: String(row.id),
            subscription: JSON.parse(String(row.body)) as {
              endpoint: string;
              keys: { p256dh: string; auth: string };
            },
          })),
      ),
    close: () => db.close(),
  };
}

export function isQuietTime(
  now: Date,
  settings: Pick<LifeSettings, "quietStart" | "quietEnd" | "timeZone">,
) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return settings.quietStart === settings.quietEnd
    ? false
    : settings.quietStart < settings.quietEnd
      ? parts >= settings.quietStart && parts < settings.quietEnd
      : parts >= settings.quietStart || parts < settings.quietEnd;
}
