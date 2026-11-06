"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { skills } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * 6-column grid on large screens: the first row holds 3 cards (2 cols each),
 * any remainder is stretched to fill the last row so there are no gaps.
 */
function spanFor(index: number, total: number) {
  const perRow = 3;
  const remainder = total % perRow;
  const inLastRow = remainder !== 0 && index >= total - remainder;
  if (!inLastRow) return "lg:col-span-2";
  return remainder === 1 ? "lg:col-span-6" : "lg:col-span-3";
}

export function Skills() {
  return (
    <Section id="skills">
      <SectionTitle
        eyebrow="Skills"
        title="What I work with"
        description="A toolbox built from years of shipping products end to end."
      />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
        {skills.map((skill, i) => (
          <Reveal
            key={skill.title}
            delay={i * 0.08}
            className={cn(
              "h-full",
              spanFor(i, skills.length),
              // odd count on 2-col tablets: let the last card span full width
              skills.length % 2 === 1 && i === skills.length - 1 && "sm:col-span-2"
            )}
          >
            <motion.div
              whileHover={{ y: -6 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="group gradient-border relative h-full overflow-hidden rounded-2xl glass p-6"
            >
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-purple-600/0 blur-2xl transition-all duration-500 group-hover:bg-purple-600/40" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <div className="inline-flex rounded-xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 p-3">
                    <skill.icon className="h-6 w-6 text-purple-300" />
                  </div>
                  <span className="text-sm font-medium tabular-nums text-white/50">
                    {skill.level}%
                  </span>
                </div>
                <h3 className="mt-4 font-display text-xl font-semibold">{skill.title}</h3>
                <div
                  className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-label={`${skill.title} proficiency`}
                  aria-valuenow={skill.level}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${skill.level}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-blue-500"
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {skill.items.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/70"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
