"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Github, ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { projects, type Project } from "@/lib/data";
import { cn } from "@/lib/utils";

function ProjectCard({ project }: { project: Project }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: -py * 8, ry: px * 8 });
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
      style={{
        transform: `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
      }}
      className={cn(
        "group gradient-border relative overflow-hidden rounded-3xl glass-strong p-7 transition-transform duration-200",
        project.span
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60 transition-opacity duration-500 group-hover:opacity-100",
          project.gradient
        )}
      />
      <div className="relative flex h-full flex-col">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="font-display text-2xl font-bold">{project.title}</h3>
          <div className="flex gap-2">
            <a
              href={project.github}
              target="_blank"
              rel="noreferrer"
              aria-label={`${project.title} GitHub`}
              className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
            >
              <Github className="h-4 w-4" />
            </a>
            <a
              href={project.demo}
              target="_blank"
              rel="noreferrer"
              aria-label={`${project.title} live demo`}
              className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
            >
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
        <p className="flex-1 text-white/70">{project.description}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {project.stack.map((s) => (
            <span
              key={s}
              className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function Projects() {
  return (
    <section id="projects" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionTitle eyebrow="Work" title="Featured projects" />
        <div className="grid auto-rows-[minmax(220px,auto)] gap-5 md:grid-cols-3">
          {projects.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08} className={p.span}>
              <ProjectCard project={p} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
