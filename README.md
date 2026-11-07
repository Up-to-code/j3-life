# J3 Life

J3 Life is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code). It keeps the coding interface and agent providers, and adds a local home for courses, daily tasks, learning notes, captures, and reminders.

The original T3 Code installation remains separate. J3 Life uses `~/.j3-life`, port **3774**, its own desktop profile and `j3life://` links. Personal records and uploads never belong in this repository.

## Run from source

Use the Node version in `package.json` and [Vite+](https://viteplus.dev/guide/).

```sh
vp i
vp run build:desktop
vp run start
```

Open **Today**, **Inbox**, or **Courses** in the sidebar. To launch the desktop shell, run `vp run start:desktop`. Development uses `vp run dev --no-seed`; give any additional instance its own home directory and ports.

New chats default to requiring approval for Mac actions. Inbox organization uses a temporary OpenCode 2 session that rejects tool requests. You can choose providers and permissions for ordinary coding conversations as usual.

## Personal features

- **Today:** up to three focus tasks, next steps, a focus timer, reminders, and daily notes.
- **Inbox:** text, camera photos, screenshots, and file copies; drafts persist on the capturing device until upload succeeds.
- **Courses:** links, lessons, notes, completion, and progress calculated from lessons.
- **Personal MCP:** `j3_life_search`, `j3_life_capture`, `j3_life_update`, and `j3_life_undo`, available through the environment's authenticated `/mcp` endpoint.
- **History:** durable change records with revision checks and undo.
- **Reminders:** quiet hours, snooze, Mac notifications, and opt-in Web Push for a supported installed iPhone web app.
- **Backups:** export and restore records, history, and attachments. Restore saves a recovery copy first.

[Using J3 Life](docs/user/j3-life.md) covers phone access, model setup, limits, and backups.

## Updates and builds

`origin` is your fork; `upstream` is `pingdotgg/t3code`. [Maintaining the fork](docs/operations/j3-life.md) describes upstream merges, checks, and Mac packaging.

Official `t3` npm updates are deliberately disabled for this fork. Desktop release checks point to `Up-to-code/j3-life`. Only publish reviewed J3 Life builds there. Do not run the original T3 installer over this app.

J3 Life retains T3 Code's MIT license and attribution. The remaining upstream documentation describes inherited coding features; use this fork's commands and home directory when following it. The native upstream mobile apps and `app.t3.codes` do not contain J3 Life's personal screens: use the web app served by your J3 Life Mac.
