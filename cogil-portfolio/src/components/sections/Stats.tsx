"use client";

import { Reveal } from "@/components/ui/Reveal";
import { CountUp } from "@/components/ui/CountUp";
import { stats } from "@/lib/data";

export function Stats() {
  return (
    <section aria-label="Highlights" className="px-5 pb-4 sm:px-6">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.1}>
            <div className="gradient-border h-full rounded-2xl glass px-4 py-6 text-center">
              <p className="bg-gradient-to-br from-purple-300 to-blue-300 bg-clip-text font-display text-3xl font-bold text-transparent sm:text-4xl">
                <CountUp value={s.value} suffix={s.suffix} />
              </p>
              <p className="mt-2 text-sm text-white/60">{s.label}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
