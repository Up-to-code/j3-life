import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { generateLifeReply } from "./life.ts";
import type { OpenCode2Connection } from "./v2/OpenCode2Server.ts";
import type { OpenCode2StreamEvent } from "./v2/OpenCode2Client.ts";

it.effect("rejects host-tool permissions while still returning the model's record proposals", () =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<OpenCode2StreamEvent>();
    const replies: Array<{ decision: string }> = [];
    let permissions: unknown;
    const sessionID = "session-personal-capture";
    const connection = {
      events: Effect.succeed(Stream.fromQueue(events)),
      client: {
        permission: {
          reply: (input: { decision: string }) =>
            Effect.sync(() => {
              replies.push(input);
            }),
        },
        session: {
          create: (input: { permissions: unknown }) =>
            Effect.sync(() => {
              permissions = input.permissions;
              return { id: sessionID };
            }),
          prompt: () =>
            Effect.gen(function* () {
              for (const event of [
                { type: "permission.asked", data: { sessionID, id: "shell-request" } },
                {
                  type: "session.text.ended",
                  data: {
                    sessionID,
                    assistantMessageID: "reply",
                    ordinal: 0,
                    text: '[{"kind":"task","title":"Read a lesson"}]',
                  },
                },
                { type: "session.execution.succeeded", data: { sessionID } },
              ])
                yield* Queue.offer(events, event as unknown as OpenCode2StreamEvent);
            }),
          interrupt: () => Effect.void,
          remove: () => Effect.void,
        },
      },
    } as unknown as OpenCode2Connection;
    expect(
      yield* generateLifeReply(connection, {
        directory: "/personal/workspace",
        model: "opencode/free",
        prompt: "Organize a capture",
        files: [],
      }),
    ).toBe('[{"kind":"task","title":"Read a lesson"}]');
    expect(permissions).toEqual([{ action: "*", resource: "*", effect: "ask" }]);
    expect(replies).toEqual([expect.objectContaining({ decision: "reject" })]);
  }),
);
