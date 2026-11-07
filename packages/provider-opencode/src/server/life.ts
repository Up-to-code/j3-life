import { AbsolutePath, Location, Model, Provider } from "@opencode/client/effect";
import { LifeError, type LifeModel } from "@t3tools/contracts/life";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as OpenCode2Server from "./v2/OpenCode2Server.ts";

export const lifeModels = Effect.fn("OpenCode.lifeModels")(function* (
  connection: OpenCode2Server.OpenCode2Connection,
  directory: string,
) {
  const result = yield* connection.client.model.list({ location: { directory } });
  return result.data
    .filter((model) => model.enabled && model.status !== "deprecated")
    .map(
      (model) =>
        ({
          id: `${model.providerID}/${model.id}`,
          name: model.name,
          free:
            model.cost.length > 0 &&
            model.cost.every((cost) => cost.input === 0 && cost.output === 0),
          images: model.capabilities.input.includes("image"),
        }) satisfies LifeModel,
    )
    .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
});

export const generateLifeReply = Effect.fn("OpenCode.generateLifeReply")(
  function* (
    connection: OpenCode2Server.OpenCode2Connection,
    input: {
      directory: string;
      model: string;
      prompt: string;
      files: readonly { uri: string; name: string }[];
    },
  ) {
    const separator = input.model.indexOf("/");
    if (separator < 1)
      return yield* new LifeError({ code: "invalid", message: "Select an OpenCode model." });
    const { client } = connection;
    const outcome = yield* Deferred.make<string, LifeError>();
    let sessionId: string | undefined;
    const texts = new Map<string, string>();
    const events = yield* connection.events;
    yield* events.pipe(
      Stream.runForEach((event) => {
        if (event.type === "unreadable.execution.ended" && event.sessionID === sessionId)
          return Deferred.fail(
            outcome,
            new LifeError({
              code: "unavailable",
              message: "OpenCode returned an unsupported response. Your capture is saved.",
            }),
          );
        if (
          sessionId === undefined ||
          !("data" in event) ||
          !("sessionID" in event.data) ||
          event.data.sessionID !== sessionId
        )
          return Effect.void;
        switch (event.type) {
          case "permission.asked":
            return client.permission
              .reply({
                sessionID: event.data.sessionID,
                requestID: event.data.id,
                decision: "reject",
                message: "Personal capture processing cannot use tools or access the Mac.",
              })
              .pipe(Effect.ignore);
          case "session.text.ended":
            texts.set(`${event.data.assistantMessageID}:${event.data.ordinal}`, event.data.text);
            return Effect.void;
          case "session.execution.succeeded":
            return Deferred.succeed(outcome, [...texts.values()].join("\n"));
          case "session.execution.failed":
          case "session.execution.interrupted":
            return Deferred.fail(
              outcome,
              new LifeError({
                code: "unavailable",
                message:
                  "The model could not finish. Your capture is saved; choose a model and retry.",
              }),
            );
          default:
            return Effect.void;
        }
      }),
      Effect.ensuring(
        Deferred.fail(
          outcome,
          new LifeError({
            code: "unavailable",
            message: "OpenCode disconnected. Your capture is saved.",
          }),
        ),
      ),
      Effect.forkScoped,
    );
    const session = yield* client.session.create({
      title: "J3 Life capture",
      location: Location.PublicRef.make({ directory: AbsolutePath.make(input.directory) }),
      model: Model.Ref.make({
        providerID: Provider.ID.make(input.model.slice(0, separator)),
        id: Model.ID.make(input.model.slice(separator + 1)),
      }),
      // Every permission is refused by the event handler, including shell, file writes, and MCP.
      permissions: [{ action: "*", resource: "*", effect: "ask" }],
    });
    sessionId = session.id;
    yield* Effect.addFinalizer(() =>
      client.session
        .interrupt({ sessionID: session.id })
        .pipe(
          Effect.ignore,
          Effect.andThen(client.session.remove({ sessionID: session.id }).pipe(Effect.ignore)),
          Effect.timeout("5 seconds"),
          Effect.ignore,
        ),
    );
    yield* client.session.prompt({
      sessionID: session.id,
      text: input.prompt,
      ...(input.files.length ? { files: [...input.files] } : {}),
    });
    return yield* Deferred.await(outcome);
  },
  Effect.timeout("3 minutes"),
  Effect.scoped,
);
