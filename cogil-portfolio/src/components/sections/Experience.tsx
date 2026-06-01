"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/Reveal";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { experiences } from "@/lib/data";

export function Experience() {
  return (
    <section id="experience" className="px-6 py-24">
      <div className="mx-auto max-w-3xl">
        <SectionTitle eyebrow="Journey" title="Experience" />
        <div className="relative">
          {/* growing line */}
          <motion.div
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            style={{ originY: 0 }}
            className="absolute left-[7px] top-2 h-full w-0.5 bg-gradient-to-b from-purple-500 via-blue-500 to-transparent md:left-1/2"
          />
          <div className="space-y-10">
            {experiences.map((exp, i) => (
              <Reveal key={exp.role} delay={i * 0.1}>
                <div
                  className={`relative flex md:items-center md:gap-8 ${
                    i % 2 === 0 ? "md:flex-row-reverse" : ""
                  }`}
                >
                  <div className="absolute left-0 top-1.5 h-4 w-4 rounded-full border-2 border-purple-400 bg-navy-900 md:left-1/2 md:-translate-x-1/2" />
                  <div className="hidden flex-1 md:block" />
                  <div className="ml-8 flex-1 rounded-2xl glass p-5 md:ml-0">
                    <p className="text-sm text-purple-300">{exp.period}</p>
                    <h3 className="mt-1 font-display text-lg font-semibold">
                      {exp.role}
                    </h3>
                    <p className="text-sm text-blue-300">{exp.company}</p>
                    <p className="mt-2 text-sm text-white/60">
                      {exp.description}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
