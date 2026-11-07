self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    /* Show the generic reminder if a payload is unreadable. */
  }
  event.waitUntil(
    self.registration.showNotification("J3 Life", {
      body:
        typeof data.body === "string"
          ? data.body
          : "A reminder is ready. Open Today when you are ready.",
      icon: "/apple-touch-icon.png",
      tag: "j3-life-reminders",
      data: { url: "/life/today" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const url = new URL("/life/today", self.location.origin).href;
      const client = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (client) {
        await client.navigate(url);
        return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
