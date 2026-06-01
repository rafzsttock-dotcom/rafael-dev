"use client";

import { Reveal } from "@/components/ui/Reveal";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Target, Award, Rocket } from "lucide-react";

const highlights = [
  { icon: Award, label: "Experience", text: "5+ years shipping production software" },
  { icon: Target, label: "Skills", text: "Full stack, automation & system design" },
  { icon: Rocket, label: "Goal", text: "Building products people love to use" },
];

export function About() {
  return (
    <section id="about" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionTitle eyebrow="About" title="A bit about me" />
        <div className="grid items-center gap-12 md:grid-cols-2">
          <Reveal>
            <div className="gradient-border relative aspect-square overflow-hidden rounded-3xl glass-strong">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-600/30 via-transparent to-blue-600/30" />
              <div className="flex h-full items-center justify-center font-display text-9xl font-bold text-white/10">
                I
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <p className="text-lg leading-relaxed text-white/70">
              I&apos;m a full stack engineer who loves turning complex problems
              into clean, fast, and beautiful products. From real-time
              dashboards to large-scale automation, I focus on craft and
              performance at every layer.
            </p>
            <div className="mt-8 space-y-4">
              {highlights.map((h) => (
                <div
                  key={h.label}
                  className="flex items-start gap-4 rounded-2xl glass p-4"
                >
                  <div className="rounded-xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 p-2.5">
                    <h.icon className="h-5 w-5 text-purple-300" />
                  </div>
                  <div>
                    <p className="font-semibold">{h.label}</p>
                    <p className="text-sm text-white/60">{h.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
