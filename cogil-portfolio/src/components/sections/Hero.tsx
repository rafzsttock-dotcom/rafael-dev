"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { MapPin } from "lucide-react";
import { MagneticButton } from "@/components/ui/MagneticButton";
import { profile } from "@/lib/data";

function useTypewriter(words: string[]) {
  const [text, setText] = useState("");
  const [wordIndex, setWordIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = words[wordIndex];
    const finishedTyping = !deleting && text === current;
    const finishedDeleting = deleting && text === "";

    // One timeout per step, always cleaned up — no stray nested timers.
    const delay = finishedTyping ? 1400 : deleting ? 45 : 90;
    const timeout = setTimeout(() => {
      if (finishedTyping) setDeleting(true);
      else if (finishedDeleting) {
        setDeleting(false);
        setWordIndex((i) => (i + 1) % words.length);
      } else {
        setText(current.slice(0, text.length + (deleting ? -1 : 1)));
      }
    }, delay);

    return () => clearTimeout(timeout);
  }, [text, deleting, wordIndex, words]);

  return text;
}

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const typed = useTypewriter(profile.roles);
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
      className="relative flex min-h-[100svh] items-center px-5 pb-16 pt-28 sm:px-6 md:pt-24"
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
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            {profile.available ? "Available for new projects" : "Currently booked"}
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="font-display text-6xl font-extrabold leading-none tracking-tight sm:text-7xl md:text-8xl"
          >
            <span className="neon-text bg-gradient-to-br from-white via-purple-200 to-blue-300 bg-clip-text text-transparent">
              {profile.name.toUpperCase()}
            </span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="mt-4 h-9 font-display text-xl font-medium text-white/80 sm:text-2xl"
            aria-label={profile.roles.join(", ")}
          >
            <span aria-hidden>{typed}</span>
            <span aria-hidden className="ml-0.5 inline-block h-6 w-[2px] animate-pulse bg-purple-400 align-middle" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="mt-6 max-w-md text-base leading-relaxed text-white/60 sm:text-lg"
          >
            {profile.tagline}
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
                  {profile.initial}
                </div>
                <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-navy-900 bg-emerald-400" />
              </div>
              <div>
                <p className="font-display font-semibold">{profile.name}</p>
                <p className="text-xs text-white/50">{profile.roles[0]}</p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2 text-sm text-white/60">
              <MapPin className="h-4 w-4 text-blue-400" />
              {profile.location}
            </div>

            <div className="mt-6">
              <p className="mb-3 text-xs uppercase tracking-wider text-white/40">
                Core Skills
              </p>
              <div className="flex flex-wrap gap-2">
                {profile.coreSkills.map((s) => (
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
