"use client";

import { useRef, useState } from "react";
import { Github, ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { projects, type Project } from "@/lib/data";
import { cn } from "@/lib/utils";

function ProjectCard({ project }: { project: Project }) {
  const ref = useRef<HTMLElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: -py * 6, ry: px * 6 });
  };

  const iconBtn =
    "rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400";

  return (
    <article
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={() => setTilt({ rx: 0, ry: 0 })}
      style={{
        transform: `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
      }}
      className="group gradient-border relative h-full overflow-hidden rounded-3xl glass-strong p-6 transition-transform duration-200 sm:p-7"
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60 transition-opacity duration-500 group-hover:opacity-100",
          project.gradient
        )}
      />
      <div className="relative flex h-full flex-col">
        {project.featured && (
          <span className="mb-3 w-fit rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-purple-200">
            Featured
          </span>
        )}
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3
            className={cn(
              "font-display font-bold",
              project.featured ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"
            )}
          >
            {project.title}
          </h3>
          <div className="flex shrink-0 gap-2">
            <a
              href={project.github}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${project.title} source on GitHub`}
              className={iconBtn}
            >
              <Github className="h-4 w-4" />
            </a>
            <a
              href={project.demo}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${project.title} live demo`}
              className={iconBtn}
            >
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
        <p
          className={cn(
            "flex-1 leading-relaxed text-white/70",
            project.featured && "sm:text-lg"
          )}
        >
          {project.description}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {project.stack.map((s) => (
            <span key={s} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
              {s}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

export function Projects() {
  return (
    <Section id="projects">
      <SectionTitle
        eyebrow="Work"
        title="Featured projects"
        description="Selected products I've designed, built and shipped."
      />
      <div className="grid gap-5 md:auto-rows-[minmax(200px,auto)] md:grid-cols-3">
        {projects.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.08} className={cn("h-full", p.span)}>
            <ProjectCard project={p} />
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
