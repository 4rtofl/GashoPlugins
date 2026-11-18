// The tokens of the work and the choice of its words are left out: #132 changes how a piece of work is told apart.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { machine, NOW, session, set } from "../../test/sdk.tsx";
import { Pondering } from "../src/web/pondering.tsx";

describe("Pondering", () => {
  it("shows a line, read out once, only while the session works", () => {
    const { rerender } = render(<Pondering machine={machine()} session={session({ status: "idle" })} />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<Pondering machine={machine()} session={session({ status: "busy" })} />);
    expect(screen.getByRole("status").textContent).toMatch(/…$/);
    rerender(<Pondering machine={machine()} session={session({ status: "waiting" })} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows how long the work has taken, and the tool running now", () => {
    set({ activity: { turnStartedAt: NOW - 192_000, tool: { name: "Bash", summary: "npm   test", startedAt: NOW - 5_000 } } });
    render(<Pondering machine={machine()} session={session({ status: "busy" })} />);
    expect(screen.getByText(/3m 12s/)).toBeTruthy();
    expect(screen.getByText("Bash(npm test)")).toBeTruthy();
  });

  it("shows no time when the start of the work is not known", () => {
    render(<Pondering machine={machine()} session={session({ status: "busy" })} />);
    expect(screen.queryByText(/^\(.+\)$/)).toBeNull();
  });
});
