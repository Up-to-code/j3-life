import {
  type ServerNpmRelease,
  ServerNpmReleaseInput,
  ServerNpmReleaseError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

const decodeInput = Schema.decodeEffect(ServerNpmReleaseInput);

export const make = Effect.fn("NpmRelease.make")(function () {
  return Effect.succeed(
    NpmRelease.of({
      get: Effect.fn("NpmRelease.get")(function* (input) {
        yield* decodeInput(input).pipe(
          Effect.mapError(
            () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
          ),
        );
        // J3 Life releases are reviewed in our GitHub fork; npm's t3 package would replace this app.
        return null;
      }),
    }),
  );
});

export const layer = Layer.effect(NpmRelease, make());
