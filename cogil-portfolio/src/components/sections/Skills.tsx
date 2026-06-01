"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/Reveal";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { skills } from "@/lib/data";

export function Skills() {
  return (
    <section id="skills" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionTitle eyebrow="Skills" title="What I work with" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill, i) => (
            <Reveal key={skill.title} delay={i * 0.08}>
              <motion.div
                whileHover={{ y: -8 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="group gradient-border relative h-full overflow-hidden rounded-2xl glass p-6"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-purple-600/0 blur-2xl transition-all duration-500 group-hover:bg-purple-600/40" />
                <div className="relative">
                  <div className="mb-4 inline-flex rounded-xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 p-3">
                    <skill.icon className="h-6 w-6 text-purple-300" />
                  </div>
                  <h3 className="font-display text-xl font-semibold">
                    {skill.title}
                  </h3>
                  <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
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
      </div>
    </section>
  );
}
