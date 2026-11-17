// A row of the list under the line of the state (a section with place "row"): a label and what it shows. Every row
// takes the list's two columns (subgrid), so the values start at the same place whatever the labels are.
import type { ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";

export function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">{children}</div>;
}

export function Row({ label, className, children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-start">
      {/* As tall as the buttons and badges of the values' first line, so it stays level with them. */}
      <span className="leading-7 whitespace-nowrap text-muted-foreground">{label}</span>
      <div className={cn("flex min-h-7 min-w-0 flex-wrap items-center gap-1.5", className)}>{children}</div>
    </div>
  );
}
