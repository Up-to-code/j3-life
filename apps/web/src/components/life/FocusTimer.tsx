import { useEffect, useState } from "react";
import { Button } from "../ui/button";

export function FocusTimer() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(25 * 60);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes the visible timer with wall time, including after a sleeping tab resumes
  useEffect(() => {
    if (deadline === null) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) setDeadline(null);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return (
    <section
      aria-label="Focus timer"
      className="flex flex-wrap items-center gap-3 rounded-xl border p-4"
    >
      <span className="text-sm text-muted-foreground">One small step</span>
      <output className="font-mono text-lg tabular-nums" aria-label="Time remaining">
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
      </output>
      <Button
        variant="outline"
        onClick={() => (deadline ? setDeadline(null) : setDeadline(Date.now() + remaining * 1000))}
        disabled={remaining === 0}
      >
        {deadline ? "Pause" : "Start focus"}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setDeadline(null);
          setRemaining(25 * 60);
        }}
      >
        Reset
      </Button>
      {remaining === 0 ? <span role="status">Time for a break.</span> : null}
    </section>
  );
}
