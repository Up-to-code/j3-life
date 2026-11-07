# Maintaining J3 Life

J3 Life keeps the upstream Git history. `origin` points to `Up-to-code/j3-life`; `upstream` points to `pingdotgg/t3code`. Runtime homes, app identifiers, CLI launchers, deep links, cookies, and desktop profiles are separate from official T3 Code.

## Integrate upstream changes

Start with a clean working tree, fetch upstream, and merge its main branch on an update branch. Resolve conflicts while retaining the J3 identity, personal service and UI, approval defaults, and fork-only update feeds. Run `vp run check:changed` and rebuild the app before merging the update into your fork's main branch.

Do not reset the custom branch to upstream, use the official installer, or replace the fork's update feed with the official feed. The inherited npm updater intentionally offers no releases; source updates use Git and packaged updates use this fork's GitHub releases.

## Build and package on macOS

Use the exact Node version from the root manifest. Install dependencies with `vp i`, then run:

```sh
vp run build:desktop
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --skip-build --no-signed
```

The generated app has bundle id `com.uptocode.j3life`, product name J3 Life, and the `j3life` protocol. Local builds can be unsigned/ad hoc signed. Public distribution requires your own Apple signing and notarization credentials. Releases must be published to `Up-to-code/j3-life`; `J3LIFE_DESKTOP_UPDATE_REPOSITORY` is the explicit build-time override.

Keep personal data and private signing material out of the repository and release bundles. Back up the personal directory before testing migrations. Use disposable state for tests and keep the original T3 service running independently.

## Surface coverage

The personal screens run in the self-hosted React web client and its Electron shell, including iPhone Safari/home-screen layouts. The upstream native mobile app and hosted web deployment do not include these additions. Ordinary coding provider adapters remain available. Capture organization currently uses OpenCode 2; other providers remain selectable for ordinary conversations and can access personal records through MCP.

Personal operations are typed RPC calls authorized by the destination environment, with the same service methods exposed through MCP. New record mutations require operate access; restore requires settings-write access. Personal processing rejects tool permissions at runtime rather than relying on prompt text alone.
