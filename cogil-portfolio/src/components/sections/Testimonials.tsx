"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Quote } from "lucide-react";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { testimonials } from "@/lib/data";

export function Testimonials() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setIndex((i) => (i + 1) % testimonials.length),
      5000
    );
    return () => clearInterval(id);
  }, []);

  const t = testimonials[index];

  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-3xl">
        <SectionTitle eyebrow="Testimonials" title="Kind words" />
        <div className="relative min-h-[220px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
              className="gradient-border rounded-3xl glass-strong p-8 text-center"
            >
              <Quote className="mx-auto mb-4 h-8 w-8 text-purple-400" />
              <p className="text-lg leading-relaxed text-white/80">
                &ldquo;{t.quote}&rdquo;
              </p>
              <div className="mt-6">
                <p className="font-display font-semibold">{t.name}</p>
                <p className="text-sm text-white/50">{t.title}</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="mt-6 flex justify-center gap-2">
          {testimonials.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Testimonial ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === index ? "w-8 bg-purple-400" : "w-2 bg-white/20"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
