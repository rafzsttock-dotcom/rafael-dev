"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { MapPin, Sparkles } from "lucide-react";
import { MagneticButton } from "@/components/ui/MagneticButton";

const roles = [
  "Software Engineer",
  "Full Stack Developer",
  "Automation Builder",
];

function useTypewriter(words: string[]) {
  const [text, setText] = useState("");
  const [wordIndex, setWordIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = words[wordIndex];
    const speed = deleting ? 45 : 90;

    const timeout = setTimeout(() => {
      if (!deleting) {
        setText(current.slice(0, text.length + 1));
        if (text.length + 1 === current.length) {
          setTimeout(() => setDeleting(true), 1400);
        }
      } else {
        setText(current.slice(0, text.length - 1));
        if (text.length === 0) {
          setDeleting(false);
          setWordIndex((i) => (i + 1) % words.length);
        }
      }
    }, speed);

    return () => clearTimeout(timeout);
  }, [text, deleting, wordIndex, words]);

  return text;
}

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const typed = useTypewriter(roles);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.8], [1, 0.92]);
  const y = useTransform(scrollYProgress, [0, 1], [0, 120]);

  return (
    <section
      ref={ref}
      className="relative flex min-h-screen items-center px-6 pt-32 md:pt-24"
    >
      <motion.div
        style={{ opacity, scale, y }}
        className="mx-auto grid w-full max-w-6xl items-center gap-12 md:grid-cols-2"
      >
        {/* Left */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 text-xs text-white/70"
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-400" />
            Available for new projects
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="font-display text-6xl font-extrabold leading-none tracking-tight sm:text-7xl md:text-8xl"
          >
            <span className="neon-text bg-gradient-to-br from-white via-purple-200 to-blue-300 bg-clip-text text-transparent">
              COGIL
            </span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="mt-4 h-9 font-display text-xl font-medium text-white/80 sm:text-2xl"
          >
            {typed}
            <span className="ml-0.5 inline-block h-6 w-[2px] animate-pulse bg-purple-400 align-middle" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="mt-6 max-w-md text-white/60"
          >
            I design and build premium, high-performance digital products —
            from elegant interfaces to powerful automation systems.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
            className="mt-9 flex flex-wrap gap-4"
          >
            <MagneticButton href="#projects" variant="primary">
              View Projects
            </MagneticButton>
            <MagneticButton href="#contact" variant="secondary">
              Contact Me
            </MagneticButton>
          </motion.div>
        </div>

        {/* Right - Glass Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="flex justify-center md:justify-end"
        >
          <div className="animate-float gradient-border w-full max-w-sm rounded-3xl glass-strong p-7">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 font-display text-2xl font-bold">
                  I
                </div>
                <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-navy-900 bg-emerald-400" />
              </div>
              <div>
                <p className="font-display font-semibold">Cogil</p>
                <p className="flex items-center gap-1 text-sm text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Online
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2 text-sm text-white/60">
              <MapPin className="h-4 w-4 text-blue-400" />
              Jakarta, Indonesia
            </div>

            <div className="mt-6">
              <p className="mb-3 text-xs uppercase tracking-wider text-white/40">
                Core Skills
              </p>
              <div className="flex flex-wrap gap-2">
                {["Next.js", "TypeScript", "Python", "Automation"].map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/80"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
