import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const lifeSnapshot = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "life:snapshot",
  tag: WS_METHODS.lifeRead,
  staleTimeMs: 5000,
});
export const lifeModels = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "life:models",
  tag: WS_METHODS.lifeModels,
  staleTimeMs: 60_000,
});
export const lifeWrite = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "life:write",
  tag: WS_METHODS.lifeWrite,
});
export const lifeProcess = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "life:process",
  tag: WS_METHODS.lifeProcess,
});
export const lifeBackup = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "life:backup",
  tag: WS_METHODS.lifeBackup,
});
export const lifeRestore = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "life:restore",
  tag: WS_METHODS.lifeRestore,
});
export const lifeAsset = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "life:asset",
  tag: WS_METHODS.lifeAsset,
});
export const lifePushKey = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "life:push-key",
  tag: WS_METHODS.lifePushKey,
});
export const lifeSubscribe = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "life:subscribe",
  tag: WS_METHODS.lifeSubscribe,
});
