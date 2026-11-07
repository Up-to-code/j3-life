import { createFileRoute, notFound } from "@tanstack/react-router";
import { LifePage } from "../components/life/LifePage";

export const Route = createFileRoute("/_chat/life/$view")({
  beforeLoad: ({ params }) => {
    if (!["today", "inbox", "courses"].includes(params.view)) throw notFound();
  },
  component: LifeRoute,
});

function LifeRoute() {
  const { view } = Route.useParams();
  return <LifePage view={view as "today" | "inbox" | "courses"} />;
}
