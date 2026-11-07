import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  LifeReadInput,
  LifeSnapshot,
  LifeRecordInput,
  LifeFile,
  LifeWriteResult,
  LifeError,
} from "@t3tools/contracts/life";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";

const shared = {
  failure: Schema.Union([LifeError, OrchestratorMcpFailure]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};
export const LifeToolkit = Toolkit.make(
  Tool.make("j3_life_search", {
    ...shared,
    description:
      "Search personal courses, tasks, reminders, captures and learning records. Omit query to list recent records. Read an exact record with id; retain its revision when updating it.",
    parameters: LifeReadInput,
    success: LifeSnapshot,
  }).annotate(Tool.Readonly, true),
  Tool.make("j3_life_update", {
    ...shared,
    description:
      "Create or update a personal task, course, lesson, learning note or reminder. Use a new requestId per intended change and reuse it only for retries. Updates require id and expectedRevision. Use relatedIds to link evidence; use progress or status for completion, dueAt for reminders. Changes are recorded and undoable. This never moves original files or executes Mac commands.",
    parameters: Schema.Struct({ requestId: Schema.String, record: LifeRecordInput }),
    success: LifeWriteResult,
  }).annotate(Tool.Destructive, true),
  Tool.make("j3_life_capture", {
    ...shared,
    description:
      "Save text and optional base64 file copies to the personal inbox before organization. Maximum 8 MB total per capture. Reuse requestId when retrying. Original files are never moved or deleted.",
    parameters: Schema.Struct({
      requestId: Schema.String,
      title: Schema.String,
      text: Schema.String,
      files: Schema.Array(LifeFile),
    }),
    success: LifeWriteResult,
  }).annotate(Tool.Destructive, true),
  Tool.make("j3_life_undo", {
    ...shared,
    description:
      "Undo a personal record change by its changeId from search history. Fails if a newer edit would be overwritten; refresh instead of forcing it.",
    parameters: Schema.Struct({ requestId: Schema.String, changeId: Schema.String }),
    success: LifeWriteResult,
  }).annotate(Tool.Destructive, true),
);
