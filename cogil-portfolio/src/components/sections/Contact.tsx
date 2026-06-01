"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Send, Check } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { SectionTitle } from "@/components/ui/SectionTitle";

export function Contact() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sent, setSent] = useState(false);

  const handleSubmit = () => {
    if (!form.name || !form.email || !form.message) return;
    // Hook up to your API / email service here.
    setSent(true);
    setTimeout(() => {
      setSent(false);
      setForm({ name: "", email: "", message: "" });
    }, 2500);
  };

  const field =
    "w-full rounded-xl bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-purple-500";

  return (
    <section id="contact" className="px-6 py-24">
      <div className="mx-auto max-w-2xl">
        <SectionTitle eyebrow="Contact" title="Let's build something" />
        <Reveal>
          <div className="gradient-border rounded-3xl glass-strong p-8">
            <div className="space-y-4">
              <input
                className={field}
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                className={field}
                placeholder="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <textarea
                className={`${field} min-h-[140px] resize-none`}
                placeholder="Message"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSubmit}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-3.5 font-semibold text-white shadow-[0_0_30px_rgba(168,85,247,0.4)] transition-shadow hover:shadow-[0_0_50px_rgba(168,85,247,0.7)]"
              >
                {sent ? (
                  <>
                    <Check className="h-4 w-4" /> Sent!
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Send Message
                  </>
                )}
              </motion.button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
