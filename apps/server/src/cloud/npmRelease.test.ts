import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NpmRelease from "./npmRelease.ts";

it.effect("never offers the official npm build as an update to J3 Life", () =>
  Effect.gen(function* () {
    const releases = yield* NpmRelease.make();
    expect(yield* releases.get({ spec: "latest" })).toBeNull();
    expect(yield* releases.get({ spec: "nightly" })).toBeNull();
  }),
);
