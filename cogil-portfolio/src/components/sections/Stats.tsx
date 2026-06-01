"use client";

import { Reveal } from "@/components/ui/Reveal";
import { CountUp } from "@/components/ui/CountUp";
import { stats } from "@/lib/data";

export function Stats() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.1}>
            <div className="gradient-border rounded-2xl glass p-6 text-center">
              <p className="font-display text-4xl font-bold text-transparent bg-gradient-to-br from-purple-300 to-blue-300 bg-clip-text">
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
