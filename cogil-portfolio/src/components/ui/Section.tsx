import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const widths = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-6xl",
} as const;

/** Shared section wrapper so every block has the same gutter, rhythm and anchor offset. */
export function Section({
  id,
  size = "lg",
  className,
  children,
}: {
  id?: string;
  size?: keyof typeof widths;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 px-5 py-20 sm:px-6 md:py-28", className)}>
      <div className={cn("mx-auto w-full", widths[size])}>{children}</div>
    </section>
  );
}
