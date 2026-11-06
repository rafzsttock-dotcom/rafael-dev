"use client";

import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { highlights, profile, stats } from "@/lib/data";

export function About() {
  return (
    <Section id="about">
      <SectionTitle eyebrow="About" title="A bit about me" />
      <div className="grid items-center gap-10 md:grid-cols-5 md:gap-14">
        <Reveal className="md:col-span-2">
          <div className="gradient-border relative mx-auto aspect-[4/5] max-w-sm overflow-hidden rounded-3xl glass-strong">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-600/35 via-transparent to-blue-600/35" />
            <div className="absolute inset-0 grid-pattern opacity-60" />
            <div className="relative flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
              <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 font-display text-5xl font-bold shadow-[0_0_60px_rgba(168,85,247,0.45)]">
                {profile.initial}
              </div>
              <div>
                <p className="font-display text-xl font-semibold">{profile.name}</p>
                <p className="text-sm text-white/60">{profile.location}</p>
              </div>
              <div className="grid w-full grid-cols-2 gap-3 pt-2">
                {stats.slice(0, 2).map((s) => (
                  <div key={s.label} className="rounded-2xl bg-white/5 px-3 py-2.5">
                    <p className="font-display text-lg font-bold">
                      {s.value}
                      {s.suffix}
                    </p>
                    <p className="text-[11px] text-white/50">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.15} className="md:col-span-3">
          <p className="text-lg leading-relaxed text-white/75">
            I&apos;m a full stack engineer who loves turning complex problems into
            clean, fast, and beautiful products. From real-time dashboards to
            large-scale automation, I focus on craft and performance at every
            layer.
          </p>
          <ul className="mt-8 space-y-3">
            {highlights.map((h) => (
              <li key={h.label} className="flex items-center gap-4 rounded-2xl glass p-4">
                <div className="shrink-0 rounded-xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 p-2.5">
                  <h.icon className="h-5 w-5 text-purple-300" />
                </div>
                <div>
                  <p className="font-semibold">{h.label}</p>
                  <p className="text-sm text-white/60">{h.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
