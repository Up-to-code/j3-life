import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/));
const Title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300));
const Body = Schema.String.check(Schema.isMaxLength(120_000));
const Timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/),
);
export const LifeKind = Schema.Literals([
  "task",
  "course",
  "lesson",
  "note",
  "learning",
  "capture",
  "reminder",
]);
export type LifeKind = typeof LifeKind.Type;
export const LifeStatus = Schema.Literals([
  "open",
  "done",
  "archived",
  "pending",
  "processing",
  "completed",
  "failed",
]);
const Fields = {
  kind: LifeKind,
  title: Title,
  body: Schema.optionalKey(Body),
  status: Schema.optionalKey(LifeStatus),
  parentId: Schema.optionalKey(Schema.NullOr(Id)),
  relatedIds: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(50))),
  date: Schema.optionalKey(
    Schema.NullOr(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
  ),
  dueAt: Schema.optionalKey(Schema.NullOr(Timestamp)),
  nextSteps: Schema.optionalKey(Schema.Array(Title).check(Schema.isMaxLength(30))),
  progress: Schema.optionalKey(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  sourceUrl: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000)))),
  attachmentIds: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
};
export const LifeRecordInput = Schema.Struct({
  ...Fields,
  id: Schema.optionalKey(Id),
  expectedRevision: Schema.optionalKey(Schema.Int),
});
export type LifeRecordInput = typeof LifeRecordInput.Type;
export const LifeRecord = Schema.Struct({
  id: Id,
  kind: LifeKind,
  title: Title,
  body: Body,
  status: LifeStatus,
  parentId: Schema.NullOr(Id),
  relatedIds: Schema.Array(Id),
  date: Schema.NullOr(Schema.String),
  dueAt: Schema.NullOr(Timestamp),
  nextSteps: Schema.Array(Title),
  progress: Schema.Number,
  sourceUrl: Schema.NullOr(Schema.String),
  attachmentIds: Schema.Array(Id),
  revision: Schema.Int,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  error: Schema.NullOr(Schema.String),
});
export type LifeRecord = typeof LifeRecord.Type;
export const LifeFile = Schema.Struct({
  name: Title,
  mime: Schema.String.check(Schema.isMaxLength(200)),
  base64: Schema.String.check(Schema.isMaxLength(12_000_000)),
});
export type LifeFile = typeof LifeFile.Type;
export const LifeAttachment = Schema.Struct({
  id: Id,
  name: Title,
  mime: Schema.String,
  size: Schema.Int,
});
export type LifeAttachment = typeof LifeAttachment.Type;
export const LifeChange = Schema.Struct({
  id: Id,
  label: Schema.String,
  at: Timestamp,
  before: Schema.Array(LifeRecord),
  after: Schema.Array(LifeRecord),
  undone: Schema.Boolean,
});
export type LifeChange = typeof LifeChange.Type;
export const LifeSettings = Schema.Struct({
  focusIds: Schema.Array(Id).check(Schema.isMaxLength(3)),
  quietStart: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
  quietEnd: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
  timeZone: Schema.String.check(Schema.isMaxLength(100)),
  model: Schema.NullOr(Schema.String.check(Schema.isMaxLength(300))),
});
export type LifeSettings = typeof LifeSettings.Type;
export const LifeSnapshot = Schema.Struct({
  records: Schema.Array(LifeRecord),
  changes: Schema.Array(LifeChange),
  attachments: Schema.Array(LifeAttachment),
  settings: LifeSettings,
});
export type LifeSnapshot = typeof LifeSnapshot.Type;
export const LifeReadInput = Schema.Struct({
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(300))),
  kind: Schema.optionalKey(LifeKind),
  id: Schema.optionalKey(Id),
});
export type LifeReadInput = typeof LifeReadInput.Type;
export const LifeWriteInput = Schema.Struct({
  requestId: Id,
  action: Schema.Union([
    Schema.Struct({ type: Schema.Literal("save"), record: LifeRecordInput }),
    Schema.Struct({
      type: Schema.Literal("capture"),
      title: Title,
      text: Body,
      files: Schema.Array(LifeFile).check(Schema.isMaxLength(8)),
    }),
    Schema.Struct({ type: Schema.Literal("undo"), changeId: Id }),
    Schema.Struct({ type: Schema.Literal("settings"), settings: LifeSettings }),
  ]),
});
export type LifeWriteInput = typeof LifeWriteInput.Type;
export const LifeWriteResult = Schema.Struct({ id: Id, changeId: Schema.NullOr(Id) });
export type LifeWriteResult = typeof LifeWriteResult.Type;
export const LifeBackup = Schema.Struct({
  version: Schema.Literal(1),
  exportedAt: Timestamp,
  snapshot: LifeSnapshot,
  files: Schema.Array(Schema.Struct({ id: Id, file: LifeFile })),
});
export type LifeBackup = typeof LifeBackup.Type;
export const LifeModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  free: Schema.Boolean,
  images: Schema.Boolean,
});
export type LifeModel = typeof LifeModel.Type;
export const LifeProcessInput = Schema.Struct({
  id: Id,
  model: Schema.String.check(Schema.isMaxLength(300)),
  allowPaid: Schema.Boolean,
});
export const LifePushSubscription = Schema.Struct({
  endpoint: Schema.String.check(Schema.isMaxLength(2000)),
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
});
export class LifeError extends Schema.TaggedError<LifeError>()("LifeError", {
  code: Schema.Literals(["invalid", "conflict", "not_found", "unavailable", "storage"]),
  message: Schema.String,
}) {}
