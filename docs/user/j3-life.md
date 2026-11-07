# Using J3 Life

Start J3 Life on your Mac and open Today, Inbox, or Courses. Your personal records are stored in `~/.j3-life/userdata/personal`; ordinary coding history lives in the same J3 Life home, separate from the original T3 app.

## A small daily loop

Add a task in Today and select **Focus today**. You can choose up to three tasks; finishing one frees its slot. Add a next step when a task feels too large. The optional timer runs on the current device.

Save thoughts, screenshots, photos, or files in Inbox. Captures are copied into managed storage; the original files are never moved or deleted. An upload can contain up to eight files totaling 8 MB. Unsent drafts stay in this browser's local storage, including their file copies, so use a trusted device. Clearing the browser's site data removes unsent drafts.

Select an OpenCode model and choose **Organize**. Free models sort first. Images require an image-capable model; paid models or models with unknown pricing require confirmation. There is no automatic paid fallback. Supported automatic inputs are images and text files. Other files remain available to download and organize manually.

Organization can create tasks, lessons, or notes and update existing records. Linked captures remain the evidence. Review the results under **Recent changes and undo**. An undo refuses to overwrite a newer edit from another device. Interrupted processing leaves the capture saved for retry.

Add courses by link or manual entry, then add lessons assigned to the course. Completing or reopening lessons recalculates course progress. Daily notes and learning records can be dated and linked to captures.

## Models and Mac access

Install and sign in to OpenCode 2 on the Mac. J3 Life discovers its enabled models and current pricing/capabilities. `J3LIFE_OPENCODE_PATH` can name a different OpenCode executable. Free access depends on the provider's availability and limits.

Inbox processing has no shell or file-operation tools. Its proposed record changes are validated and committed by J3 Life. Normal conversations retain T3 Code's provider picker and approval interface; they default to approval-required mode. Approve original-file operations there when you intentionally request them.

Other MCP clients can connect to this environment's `/mcp` endpoint using the inherited authentication flow. The `j3_life_*` tools search, capture, update progress/reminders, and undo record changes. Updates require a retry key and, for existing records, the current revision. A read-only client cannot change records.

## Choose the Mac host

Use one host for your J3 Life home at a time. The Mac app hosts its own server and keeps running when its window closes; quitting the app stops processing and reminders. For headless use, quit the Mac app, run `j3-life service install`, then use the browser client. Before returning to the Mac app, run `j3-life service uninstall`. Both modes use the same saved J3 Life data. Never delete the server ownership lock to force two hosts to share it.

## Connect an iPhone

For local network access, run your J3 Life CLI with `up --lan`, or enable network access in **Settings → Sharing & access**. Create a pairing link and scan its QR code. Pair each device separately and revoke it from Sharing & access when necessary.

For camera features and push reminders, use HTTPS. Install Tailscale on the Mac and phone, sign in to the same tailnet, and enable **Tailscale HTTPS** in J3 Life's Sharing & access settings. Follow Tailscale's sign-in and HTTPS consent steps. If another app already uses the default Tailscale HTTPS port, choose another port for J3 Life; do not replace the other app's route.

Open the J3 Life address in Safari, then use **Share → Add to Home Screen**. Open that installed web app and enable phone reminders. The official T3 mobile app does not include these personal screens.

Your Mac must remain awake, running J3 Life, and connected for phone access, processing, and scheduled reminders. Your phone needs connectivity to reach it. A sleeping/offline Mac does not provide an always-online cloud service.

## Reminders and recovery

Set a task's reminder time in its editor. Today lets you snooze it for 30 minutes; edit the reminder time to reschedule or clear it. Complete a reminder to dismiss it. Quiet hours use your saved time zone and apply on the Mac scheduler. Equal start/end times disable quiet hours.

Enable or disable phone reminders per paired connection under **Reminders, phone access, and backups**. On iPhone, push requires a supported iOS version, an installed home-screen web app, and notification permission. A Mac notification may also require macOS permission for the delivering process.

Overdue reminders remain visible after downtime. The scheduler groups due items and persists a delivery claim before notifying, preventing repeated notifications after a restart. A crash during handoff can lose an alert; the overdue task remains visible. Browser/platform push services deliver notification payloads, but the personal database stays on the Mac.

Export a personal backup from the same panel. Portable JSON backups include records, history, and file bytes and are limited to 64 MB. For larger libraries, stop J3 Life and copy its entire personal directory. Keep backups private. Before replacing records during restore, J3 Life writes a recovery backup under `personal/backups`. Notification permissions and device enrollment may need to be repeated on a new Mac.
