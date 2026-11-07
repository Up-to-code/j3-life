import { useNowMinute } from "../../hooks/useNowMinute";
import { randomUUID } from "../../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LifeBackup,
  type LifeKind,
  type LifeRecord,
  type LifeRecordInput,
  type LifeSettings,
  type LifeWriteInput,
} from "@t3tools/contracts/life";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import * as Life from "../../state/life";
import { requestConfirmDialog } from "../../confirmDialog";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { LifeNavigation } from "./LifeNavigation";
import { FocusTimer } from "./FocusTimer";
import { encodeCaptureFile, loadDraft, saveDraft, type CaptureDraft } from "./drafts";

type View = "today" | "inbox" | "courses";
const titles = {
  today: "A little progress, today.",
  inbox: "A place for everything on your mind.",
  courses: "Keep what you learn.",
};
const decodeBackup = Schema.decodeUnknownSync(LifeBackup);
const uniqueFiles = (files: File[]) => [
  ...new Map(
    files.map((file) => [`${file.name}-${file.lastModified}-${file.size}`, file]),
  ).values(),
];
const emptyDraft = (): CaptureDraft => ({
  requestId: randomUUID(),
  title: "",
  text: "",
  files: [],
});
const selectClass =
  "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm";
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed. Your saved data is retained.";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function LifePage({ view }: { view: View }) {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environmentId = selected ?? primary ?? environments[0]?.environmentId ?? null;
  return (
    <SidebarInset role="main" className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <SidebarTrigger />
        <span className="text-sm font-medium">J3 Life</span>
      </WorkspacePageHeader>
      <div className="scrollbar-gutter-both flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid w-full max-w-4xl gap-6 p-4 pb-16 sm:p-8">
          <LifeNavigation />
          <header className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {view}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{titles[view]}</h1>
            <p className="text-sm text-muted-foreground">
              {view === "today"
                ? "Choose up to three things. Start with one small step."
                : view === "inbox"
                  ? "Capture now. Organize when you have the space."
                  : "Courses, small lessons, and the things you want to remember."}
            </p>
          </header>
          {environments.length > 1 ? (
            <Field label="Mac or environment">
              <select
                aria-label="Mac or environment"
                className={selectClass}
                value={environmentId ?? ""}
                onChange={(event) => setSelected(event.target.value as EnvironmentId)}
              >
                {environments.map((environment) => (
                  <option key={environment.environmentId} value={environment.environmentId}>
                    {environment.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {environmentId ? (
            <LifeWorkspace key={environmentId} environmentId={environmentId} view={view} />
          ) : (
            <p role="status">
              Connect your Mac in{" "}
              <Link to="/settings/connections" className="underline">
                Environments
              </Link>{" "}
              to open your personal records.
            </p>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function LifeWorkspace({ environmentId, view }: { environmentId: EnvironmentId; view: View }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const snapshot = useEnvironmentQuery(
    Life.lifeSnapshot({ environmentId, input: search ? { query: search } : {} }),
  );
  const models = useEnvironmentQuery(
    view === "inbox" ? Life.lifeModels({ environmentId, input: {} }) : null,
  );
  const canWrite = useAtomValue(Life.lifeWrite.permissionAtom(environmentId));
  const canRestore = useAtomValue(Life.lifeRestore.permissionAtom(environmentId));
  const writeCommand = useAtomCommand(Life.lifeWrite);
  const processCommand = useAtomCommand(Life.lifeProcess);
  const exportCommand = useAtomCommand(Life.lifeBackup);
  const restoreCommand = useAtomCommand(Life.lifeRestore);
  const assetCommand = useAtomCommand(Life.lifeAsset);
  const pushKeyCommand = useAtomCommand(Life.lifePushKey);
  const subscribeCommand = useAtomCommand(Life.lifeSubscribe);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<LifeRecord | "new" | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [draftReady, setDraftReady] = useState(false);
  const draftQueue = useRef(Promise.resolve());
  const [model, setModel] = useState("");
  const data = snapshot.data;
  const now = useNowMinute();
  const refreshSnapshot = snapshot.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores a persisted photo/text draft from this device's IndexedDB
  useEffect(() => {
    let active = true;
    void loadDraft(environmentId)
      .then((saved) => {
        if (active) {
          if (saved) setDraft(saved);
          setDraftReady(true);
        }
      })
      .catch((error) => {
        if (active) {
          setError(messageOf(error));
          setDraftReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [environmentId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes server-owned records after reconnect, returning to the app, and background agent edits
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) refreshSnapshot();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [refreshSnapshot]);
  const persistDraft = (next: CaptureDraft) => {
    setDraft(next);
    draftQueue.current = draftQueue.current
      .catch(() => undefined)
      .then(() => saveDraft(environmentId, next))
      .catch((error) => setError(messageOf(error)));
  };
  const mutate = async (action: LifeWriteInput["action"], requestId = randomUUID()) => {
    setError(null);
    const result = await writeCommand({ environmentId, input: { requestId, action } });
    if (result._tag === "Failure") {
      setError(messageOf(Cause.squash(result.cause)));
      return false;
    }
    snapshot.refresh();
    return true;
  };
  const perform = async (key: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setError(messageOf(error));
    }
    setBusy(null);
  };
  const saveSettings = (settings: LifeSettings) => mutate({ type: "settings", settings });
  const changeRecord = (record: LifeRecord, fields: Partial<LifeRecordInput>) =>
    mutate({ type: "save", record: { ...record, ...fields, expectedRevision: record.revision } });
  const selectedModel =
    model || data?.settings.model || models.data?.find((model) => model.free)?.id || "";
  const enablePush = async () => {
    if (
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    )
      throw new Error(
        "Open J3 Life over HTTPS. On iPhone, add it to the Home Screen, then enable reminders from that app.",
      );
    if (
      Notification.permission !== "granted" &&
      (await Notification.requestPermission()) !== "granted"
    )
      throw new Error(
        "Notifications are off. You can still see reminders in Today; enable them in device settings when ready.",
      );
    const registration = await navigator.serviceWorker.register("/j3-life-sw.js");
    await navigator.serviceWorker.ready;
    const key = await pushKeyCommand({ environmentId, input: {} });
    if (key._tag !== "Success")
      throw new Error(
        key._tag === "Failure" ? messageOf(Cause.squash(key.cause)) : "Push is unavailable.",
      );
    const publicKey = Uint8Array.from(
      atob(
        key.value.replaceAll("-", "+").replaceAll("_", "/") +
          "=".repeat((4 - (key.value.length % 4)) % 4),
      ),
      (char) => char.charCodeAt(0),
    );
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      }));
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
      throw new Error("This browser returned an incomplete push subscription.");
    const result = await subscribeCommand({
      environmentId,
      input: {
        subscription: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        },
      },
    });
    if (result._tag === "Failure") throw Cause.squash(result.cause);
    setNotice("Reminders are enabled on this device. Your Mac must stay awake and connected.");
  };
  if (!data)
    return (
      <div className="space-y-3" role={snapshot.error ? "alert" : "status"}>
        <p>{snapshot.error ?? "Opening your personal records…"}</p>
        <Button variant="outline" onClick={snapshot.refresh}>
          Try again
        </Button>
      </div>
    );
  const records = data.records.filter((record) => record.status !== "archived");
  const tasks = records.filter((record) => record.kind === "task");
  const focusTasks = data.settings.focusIds
    .map((id) => tasks.find((task) => task.id === id))
    .filter((task): task is LifeRecord => task !== undefined && task.status !== "done");
  const captures = records.filter((record) => record.kind === "capture");
  const courses = records.filter((record) => record.kind === "course");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: data.settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const shown = search
    ? records
    : view === "inbox"
      ? captures
      : view === "courses"
        ? courses
        : [
            ...focusTasks,
            ...tasks.filter((task) => !focusTasks.includes(task) && task.status !== "done"),
            ...records.filter(
              (record) =>
                (record.kind === "reminder" && record.status === "open") ||
                ((record.kind === "note" || record.kind === "learning") && record.date === today),
            ),
          ];
  return (
    <>
      {error || snapshot.error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
          {error ?? snapshot.error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {notice}
        </p>
      ) : null}
      {!canWrite ? (
        <p className="text-sm text-muted-foreground">
          This connection can read personal records. Pair with permission to operate to make
          changes.
        </p>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query);
        }}
      >
        <div className="flex-1">
          <Input
            type="search"
            aria-label="Search personal records"
            placeholder="Find a task, lesson, or something you learned…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button variant="outline" type="submit">
          Search
        </Button>
        {search ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setQuery("");
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>
      {view === "today" && !search ? <FocusTimer /> : null}
      {view === "inbox" && canWrite ? (
        <form
          className="grid gap-4 rounded-xl border p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void perform("capture", async () => {
              if (draft.files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024)
                throw new Error("Choose files totaling 8 MB or less.");
              const files = await Promise.all(draft.files.map(encodeCaptureFile));
              const saved = await mutate(
                {
                  type: "capture",
                  title:
                    draft.title.trim() ||
                    draft.text.trim().slice(0, 80) ||
                    draft.files[0]?.name ||
                    "New capture",
                  text: draft.text,
                  files,
                },
                draft.requestId,
              );
              if (saved) {
                const next = emptyDraft();
                setDraft(next);
                await draftQueue.current;
                await saveDraft(environmentId, null);
                setNotice("Saved to your Mac. Choose Organize when you are ready.");
              }
            });
          }}
        >
          <Field label="Capture title">
            <Input
              aria-label="Capture title"
              maxLength={300}
              value={draft.title}
              disabled={!draftReady || busy === "capture"}
              placeholder="Optional: what is this about?"
              onChange={(event) =>
                persistDraft({ ...draft, title: event.target.value, requestId: randomUUID() })
              }
            />
          </Field>
          <Field label="What do you want to remember?">
            <Textarea
              aria-label="What do you want to remember?"
              maxLength={120000}
              value={draft.text}
              disabled={!draftReady || busy === "capture"}
              placeholder="A thought, a task, or what you learned today…"
              onChange={(event) =>
                persistDraft({ ...draft, text: event.target.value, requestId: randomUUID() })
              }
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Take a photo">
              <Input
                type="file"
                aria-label="Take a photo"
                accept="image/*"
                capture="environment"
                disabled={!draftReady || busy !== null}
                onChange={(event) => {
                  if (event.target.files)
                    persistDraft({
                      ...draft,
                      files: uniqueFiles([...draft.files, ...event.target.files]),
                      requestId: randomUUID(),
                    });
                  event.target.value = "";
                }}
              />
            </Field>
            <Field label="Attach files">
              <Input
                type="file"
                aria-label="Attach files"
                multiple
                disabled={!draftReady || busy !== null}
                onChange={(event) => {
                  if (event.target.files)
                    persistDraft({
                      ...draft,
                      files: uniqueFiles([...draft.files, ...event.target.files]),
                      requestId: randomUUID(),
                    });
                  event.target.value = "";
                }}
              />
            </Field>
          </div>
          {draft.files.map((file, index) => (
            <div
              key={`${file.name}-${file.lastModified}-${file.size}`}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate">{file.name}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${file.name}`}
                disabled={busy !== null}
                onClick={() =>
                  persistDraft({
                    ...draft,
                    files: draft.files.filter((_, i) => i !== index),
                    requestId: randomUUID(),
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={
                !draftReady ||
                busy !== null ||
                (!draft.text.trim() && !draft.title.trim() && draft.files.length === 0)
              }
            >
              {busy === "capture" ? "Saving…" : "Save capture"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Up to 8 MB total. Drafts stay on this device until saved.
            </p>
          </div>
        </form>
      ) : null}
      {view === "inbox" ? (
        <div className="grid gap-2">
          <Label>Organizing model</Label>
          <select
            aria-label="Organizing model"
            className={selectClass}
            value={selectedModel}
            onChange={(event) => {
              setModel(event.target.value);
              void saveSettings({ ...data.settings, model: event.target.value });
            }}
            disabled={!canWrite || busy !== null}
          >
            <option value="">Choose an available model</option>
            {models.data?.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.free ? "Free" : "Paid / pricing unknown"}
                {model.images ? " · Images" : " · Text"}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            OpenCode organizes captures. All your configured providers remain available in chat.
          </p>
          {models.error ? (
            <div role="alert">
              <p className="text-sm">{models.error}</p>
              <Button variant="ghost" onClick={models.refresh}>
                Refresh models
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">
          {search
            ? "Search results"
            : view === "today"
              ? "Your next steps"
              : view === "inbox"
                ? "Captured and kept"
                : "Your courses"}
        </h2>
        <Button
          variant="outline"
          disabled={!canWrite || busy !== null}
          onClick={() => setEditing("new")}
        >
          {view === "courses" ? "Add course or lesson" : "Add task or note"}
        </Button>
      </div>
      {editing ? (
        <RecordEditor
          key={editing === "new" ? "new" : `${editing.id}-${editing.revision}`}
          record={editing === "new" ? null : editing}
          defaultKind={view === "courses" ? "course" : "task"}
          records={records}
          disabled={busy !== null}
          onCancel={() => setEditing(null)}
          onSave={(record) =>
            perform("save", async () => {
              if (await mutate({ type: "save", record })) setEditing(null);
            })
          }
        />
      ) : null}
      <div className="grid gap-3" aria-busy={snapshot.isPending || busy !== null}>
        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
            {search
              ? "No matching records. Try a shorter search."
              : view === "inbox"
                ? "Your inbox is ready. Save a thought, photo, or file above."
                : view === "courses"
                  ? "Add a course link, then break it into small lessons."
                  : "There is room to start small. Add a task or capture what is on your mind."}
          </p>
        ) : null}
        {shown.map((record) => (
          <article key={record.id} className="grid gap-3 rounded-xl border p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {record.kind} · {record.status}
                  {data.settings.focusIds.includes(record.id) ? " · Today’s focus" : ""}
                </p>
                <h3 className="mt-1 break-words font-medium">{record.title}</h3>
              </div>
              {record.kind === "course" ? (
                <span className="text-sm tabular-nums">{Math.round(record.progress)}%</span>
              ) : null}
            </div>
            {record.body ? (
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {record.body}
              </p>
            ) : null}
            {record.sourceUrl && /^https?:\/\//i.test(record.sourceUrl) ? (
              <a
                href={record.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="w-fit text-sm underline underline-offset-4"
              >
                Open course link
              </a>
            ) : null}
            {record.kind === "course" ? (
              <>
                <progress
                  aria-label={`${record.title} progress`}
                  className="h-2 w-full accent-primary"
                  max={100}
                  value={record.progress}
                />
                <div className="grid gap-2">
                  {records
                    .filter((lesson) => lesson.kind === "lesson" && lesson.parentId === record.id)
                    .map((lesson) => (
                      <div
                        key={lesson.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <span>
                          {lesson.status === "done" ? "✓ " : ""}
                          {lesson.title}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canWrite || busy !== null}
                          onClick={() =>
                            void perform(lesson.id, async () => {
                              await changeRecord(lesson, {
                                status: lesson.status === "done" ? "open" : "done",
                                progress: lesson.status === "done" ? 0 : 100,
                              });
                            })
                          }
                        >
                          {lesson.status === "done" ? "Reopen lesson" : "Complete lesson"}
                        </Button>
                      </div>
                    ))}
                </div>
              </>
            ) : null}
            {record.nextSteps.length ? (
              <ol className="list-inside list-decimal space-y-1 text-sm">
                {[...new Set(record.nextSteps)].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
            {record.dueAt ? (
              <p className="text-xs text-muted-foreground">
                Reminder:{" "}
                {new Date(record.dueAt).toLocaleString(undefined, {
                  timeZone: data.settings.timeZone,
                })}
              </p>
            ) : null}
            {record.relatedIds.length ? (
              <p className="text-xs text-muted-foreground">
                Linked evidence:{" "}
                {record.relatedIds
                  .map((id) => records.find((item) => item.id === id)?.title ?? "Saved record")
                  .join(", ")}
              </p>
            ) : null}
            {record.error ? (
              <p role="alert" className="text-sm">
                {record.error}
              </p>
            ) : null}
            {record.attachmentIds.map((id) => (
              <div key={id}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void perform(`file-${id}`, async () => {
                      const result = await assetCommand({ environmentId, input: { id } });
                      if (result._tag === "Failure") throw Cause.squash(result.cause);
                      if (result._tag === "Success") {
                        const file = result.value;
                        const bytes = Uint8Array.from(atob(file.base64), (char) =>
                          char.charCodeAt(0),
                        );
                        download(file.name, new Blob([bytes], { type: file.mime }));
                      }
                    })
                  }
                >
                  Download {data.attachments.find((file) => file.id === id)?.name ?? "attachment"}
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {record.kind === "task" || record.kind === "reminder" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canWrite || busy !== null}
                  onClick={() =>
                    void perform(record.id, async () => {
                      await changeRecord(record, {
                        status: record.status === "done" ? "open" : "done",
                        progress: record.status === "done" ? 0 : 100,
                      });
                    })
                  }
                >
                  {record.status === "done" ? "Reopen" : "Done"}
                </Button>
              ) : null}
              {record.kind === "task" && record.status !== "done" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    !canWrite ||
                    busy !== null ||
                    (!data.settings.focusIds.includes(record.id) &&
                      data.settings.focusIds.length >= 3)
                  }
                  onClick={() =>
                    void perform("focus", async () => {
                      await saveSettings({
                        ...data.settings,
                        focusIds: data.settings.focusIds.includes(record.id)
                          ? data.settings.focusIds.filter((id) => id !== record.id)
                          : [...data.settings.focusIds, record.id],
                      });
                    })
                  }
                >
                  {data.settings.focusIds.includes(record.id) ? "Remove focus" : "Focus today"}
                </Button>
              ) : null}
              {record.kind === "capture" && record.status !== "completed" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    !canWrite || busy !== null || !selectedModel || record.status === "processing"
                  }
                  onClick={() =>
                    void perform(record.id, async () => {
                      const selected = models.data?.find((model) => model.id === selectedModel);
                      if (!selected) throw new Error("Select an available organizing model.");
                      const allowPaid =
                        !selected.free &&
                        (await requestConfirmDialog(
                          `Use ${selected.name}? This model may charge your provider account.`,
                        )) === true;
                      if (!selected.free && !allowPaid) return;
                      const result = await processCommand({
                        environmentId,
                        input: { id: record.id, model: selectedModel, allowPaid },
                      });
                      snapshot.refresh();
                      if (result._tag === "Failure") throw Cause.squash(result.cause);
                    })
                  }
                >
                  {busy === record.id || record.status === "processing"
                    ? "Organizing…"
                    : record.status === "failed"
                      ? "Retry organization"
                      : "Organize"}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={!canWrite || busy !== null || record.status === "processing"}
                onClick={() => setEditing(record)}
              >
                Edit
              </Button>
              {record.dueAt && record.status === "open" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canWrite || busy !== null}
                  onClick={() =>
                    void perform(record.id, async () => {
                      await changeRecord(record, {
                        dueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
                      });
                    })
                  }
                >
                  Snooze 30 min
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={!canWrite || busy !== null || record.status === "processing"}
                onClick={() =>
                  void perform(record.id, async () => {
                    await changeRecord(record, { status: "archived" });
                  })
                }
              >
                Archive
              </Button>
            </div>
          </article>
        ))}
      </div>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">Recent changes and undo</summary>
        <div className="mt-4 grid gap-3">
          {data.changes.map((change) => (
            <div
              key={change.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>{change.label}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canWrite || busy !== null || change.undone}
                onClick={() =>
                  void perform(change.id, async () => {
                    await mutate({ type: "undo", changeId: change.id });
                  })
                }
              >
                {change.undone ? "Undone" : "Undo"}
              </Button>
            </div>
          ))}
          {!data.changes.length ? (
            <p className="text-sm text-muted-foreground">Your changes will appear here.</p>
          ) : null}
        </div>
      </details>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Reminders, phone access, and backups
        </summary>
        <div className="mt-4 grid gap-5">
          <p className="text-sm text-muted-foreground">
            For iPhone: open your Mac’s Tailscale HTTPS address in Safari and choose Share → Add to
            Home Screen. Pair your device in{" "}
            <Link to="/settings/connections" className="underline">
              Environments
            </Link>
            . Your Mac must stay awake and connected.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!canWrite || busy !== null}
              onClick={() => void perform("push", enablePush)}
            >
              Enable phone reminders
            </Button>
            <Button
              variant="ghost"
              disabled={!canWrite || busy !== null}
              onClick={() =>
                void perform("push", async () => {
                  const result = await subscribeCommand({
                    environmentId,
                    input: { subscription: null },
                  });
                  if (result._tag === "Failure") throw Cause.squash(result.cause);
                  setNotice("Phone reminders are disabled for this connection.");
                })
              }
            >
              Disable phone reminders
            </Button>
          </div>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              void perform("settings", async () => {
                if (
                  await saveSettings({
                    ...data.settings,
                    quietStart: String(values.get("start")),
                    quietEnd: String(values.get("end")),
                    timeZone: String(values.get("zone")),
                  })
                )
                  setNotice("Quiet hours saved.");
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Quiet hours start">
                <Input
                  type="time"
                  name="start"
                  aria-label="Quiet hours start"
                  defaultValue={data.settings.quietStart}
                  required
                />
              </Field>
              <Field label="Quiet hours end">
                <Input
                  type="time"
                  name="end"
                  aria-label="Quiet hours end"
                  defaultValue={data.settings.quietEnd}
                  required
                />
              </Field>
              <Field label="Time zone">
                <Input
                  name="zone"
                  aria-label="Time zone"
                  defaultValue={data.settings.timeZone}
                  required
                />
              </Field>
            </div>
            <div>
              <Button variant="outline" type="submit" disabled={!canWrite || busy !== null}>
                Save quiet hours
              </Button>
            </div>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void perform("backup", async () => {
                  const result = await exportCommand({ environmentId, input: {} });
                  if (result._tag === "Failure") throw Cause.squash(result.cause);
                  if (result._tag === "Success")
                    download(
                      `j3-life-${new Date().toISOString().slice(0, 10)}.j3life-backup.json`,
                      new Blob([JSON.stringify(result.value)], { type: "application/json" }),
                    );
                })
              }
            >
              Export personal backup
            </Button>
          </div>
          {canRestore ? (
            <Field label="Restore a personal backup">
              <Input
                type="file"
                aria-label="Restore a personal backup"
                accept=".json"
                disabled={busy !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void perform("restore", async () => {
                    if (file.size > 64 * 1024 * 1024) throw new Error("Backup exceeds 64 MB.");
                    const backup = decodeBackup(JSON.parse(await file.text()));
                    if (
                      (await requestConfirmDialog(
                        "Replace your personal records with this backup? J3 Life saves a recovery backup on your Mac first.",
                      )) !== true
                    )
                      return;
                    const result = await restoreCommand({ environmentId, input: backup });
                    if (result._tag === "Failure") throw Cause.squash(result.cause);
                    snapshot.refresh();
                    setNotice("Personal backup restored.");
                  });
                }}
              />
            </Field>
          ) : null}
        </div>
      </details>
    </>
  );
}

function RecordEditor({
  record,
  defaultKind,
  records,
  disabled,
  onCancel,
  onSave,
}: {
  record: LifeRecord | null;
  defaultKind: LifeKind;
  records: readonly LifeRecord[];
  disabled: boolean;
  onCancel: () => void;
  onSave: (record: LifeRecordInput) => Promise<void>;
}) {
  const now = useNowMinute();
  const [kind, setKind] = useState<LifeKind>(record?.kind ?? defaultKind);
  return (
    <form
      className="grid gap-4 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const due = String(data.get("due") ?? "");
        void onSave({
          ...(record ? { ...record, expectedRevision: record.revision } : {}),
          kind,
          title: String(data.get("title")).trim(),
          body: String(data.get("body")),
          parentId: String(data.get("parent")) || null,
          sourceUrl: String(data.get("url")) || null,
          progress: Number(data.get("progress") ?? 0),
          nextSteps: String(data.get("steps"))
            .split("\n")
            .map((step) => step.trim())
            .filter(Boolean),
          relatedIds: [
            ...new Set(
              [...(record?.relatedIds ?? []), String(data.get("evidence") ?? "")].filter(Boolean),
            ),
          ],
          date: String(data.get("date")) || null,
          dueAt: due ? new Date(due).toISOString() : null,
        });
      }}
    >
      <Field label="Record type">
        <select
          aria-label="Record type"
          className={selectClass}
          value={kind}
          disabled={record !== null || disabled}
          onChange={(event) => setKind(event.target.value as LifeKind)}
        >
          {["task", "course", "lesson", "note", "learning", "reminder"].map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
          {record?.kind === "capture" ? <option value="capture">capture</option> : null}
        </select>
      </Field>
      <Field label="Title">
        <Input
          name="title"
          aria-label="Title"
          defaultValue={record?.title ?? ""}
          maxLength={300}
          required
        />
      </Field>
      <Field label="Notes">
        <Textarea
          name="body"
          aria-label="Notes"
          defaultValue={record?.body ?? ""}
          maxLength={120000}
        />
      </Field>
      <Field label="Link captured evidence">
        <select
          name="evidence"
          aria-label="Link captured evidence"
          className={selectClass}
          defaultValue=""
        >
          <option value="">Choose a capture (optional)</option>
          {records
            .filter((item) => item.kind === "capture" && item.id !== record?.id)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Next steps, one per line">
        <Textarea
          name="steps"
          aria-label="Next steps, one per line"
          defaultValue={record?.nextSteps.join("\n") ?? ""}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Course">
          <select
            name="parent"
            aria-label="Course"
            className={selectClass}
            defaultValue={record?.parentId ?? ""}
            required={kind === "lesson"}
          >
            <option value="">No course</option>
            {records
              .filter((record) => record.kind === "course")
              .map((record) => (
                <option key={record.id} value={record.id}>
                  {record.title}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Course or source link">
          <Input
            name="url"
            type="url"
            aria-label="Course or source link"
            defaultValue={record?.sourceUrl ?? ""}
            maxLength={2000}
          />
        </Field>
        <Field label="Progress (%)">
          <Input
            name="progress"
            type="number"
            aria-label="Progress (%)"
            min={0}
            max={100}
            defaultValue={record?.progress ?? 0}
          />
        </Field>
        <Field label="Day learned or recorded">
          <Input
            name="date"
            type="date"
            aria-label="Day learned or recorded"
            defaultValue={record?.date ?? new Intl.DateTimeFormat("en-CA").format(new Date(now))}
          />
        </Field>
        <Field label="Remind me (device local time)">
          <Input
            name="due"
            type="datetime-local"
            aria-label="Remind me (device local time)"
            defaultValue={record?.dueAt ? localInputDate(record.dueAt) : ""}
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={disabled}>
          Save record
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function localInputDate(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
