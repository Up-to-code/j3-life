import * as Option from "effect/Option";
import { LifeError } from "@t3tools/contracts/life";
import * as Effect from "effect/Effect";
import * as LifeService from "../../../life/LifeService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { LifeToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(
  LifeToolkit,
  Effect.gen(function* () {
    const optional = yield* Effect.serviceOption(LifeService.LifeService);
    const use = <A>(
      f: (life: LifeService.LifeService["Service"]) => Effect.Effect<A, LifeError>,
    ) =>
      Option.isSome(optional)
        ? f(optional.value)
        : Effect.fail(
            new LifeError({
              code: "unavailable",
              message: "Personal records are not available on this environment.",
            }),
          );
    return {
      j3_life_search: McpToolAccess.reads((input) => use((life) => life.read(input))),
      j3_life_update: McpToolAccess.writesWithCapability((input) =>
        use((life) =>
          life.write({
            requestId: input.requestId,
            action: { type: "save", record: input.record },
          }),
        ),
      ),
      j3_life_capture: McpToolAccess.writesWithCapability((input) =>
        use((life) =>
          life.write({
            requestId: input.requestId,
            action: { type: "capture", title: input.title, text: input.text, files: input.files },
          }),
        ),
      ),
      j3_life_undo: McpToolAccess.writesWithCapability((input) =>
        use((life) =>
          life.write({
            requestId: input.requestId,
            action: { type: "undo", changeId: input.changeId },
          }),
        ),
      ),
    };
  }),
);
