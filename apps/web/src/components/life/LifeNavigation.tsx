import { Link } from "@tanstack/react-router";
import { BookOpenIcon, InboxIcon, SunIcon } from "lucide-react";
import { Button } from "../ui/button";

const destinations = [
  { view: "today", title: "Today", Icon: SunIcon },
  { view: "inbox", title: "Inbox", Icon: InboxIcon },
  { view: "courses", title: "Courses", Icon: BookOpenIcon },
] as const;

export function LifeNavigation() {
  return (
    <nav aria-label="Personal life" className="flex flex-wrap gap-1 px-2 py-2">
      {destinations.map(({ view, title, Icon }) => (
        <Button
          key={view}
          variant="ghost"
          size="sm"
          render={
            <Link to="/life/$view" params={{ view }} activeProps={{ "aria-current": "page" }} />
          }
        >
          <Icon aria-hidden="true" />
          {title}
        </Button>
      ))}
    </nav>
  );
}
