"use client";

import { motion } from "framer-motion";
import { Briefcase } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { experiences } from "@/lib/data";

export function Experience() {
  return (
    <Section id="experience" size="md">
      <SectionTitle eyebrow="Journey" title="Experience" />
      <ol className="relative">
        {/* growing line — sits exactly behind the dots */}
        <motion.div
          aria-hidden
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{ originY: 0 }}
          className="absolute bottom-0 left-[19px] top-2 w-0.5 bg-gradient-to-b from-purple-500 via-blue-500 to-transparent"
        />
        {experiences.map((exp, i) => (
          <li key={exp.role} className="relative pb-8 pl-14 last:pb-0">
            <div className="absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-full border border-purple-400/50 bg-navy-900 shadow-[0_0_20px_rgba(168,85,247,0.35)]">
              <Briefcase className="h-4 w-4 text-purple-300" />
            </div>
            <Reveal delay={i * 0.1}>
              <div className="rounded-2xl glass p-5 sm:p-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <h3 className="font-display text-lg font-semibold">{exp.role}</h3>
                  <span className="text-sm text-purple-300">{exp.period}</span>
                </div>
                <p className="text-sm text-blue-300">{exp.company}</p>
                <p className="mt-3 text-sm leading-relaxed text-white/65">{exp.description}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
