"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Send, Check, Mail, MapPin } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { profile, socials } from "@/lib/data";

type Status = "idle" | "sent";

export function Contact() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState<Status>("idle");

  const update =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Native `required` / `type="email"` validation runs before this fires.
    // TODO: hook up to your API / email service here (e.g. Resend, Formspree).
    setStatus("sent");
    setTimeout(() => {
      setStatus("idle");
      setForm({ name: "", email: "", message: "" });
    }, 2500);
  };

  const field =
    "w-full rounded-xl bg-white/5 px-4 py-3 text-white placeholder:text-white/35 outline-none ring-1 ring-white/10 transition focus:bg-white/[0.07] focus:ring-2 focus:ring-purple-500";
  const label = "mb-1.5 block text-sm font-medium text-white/70";

  return (
    <Section id="contact" size="md">
      <SectionTitle
        eyebrow="Contact"
        title="Let's build something"
        description="Have a project in mind or just want to say hi? My inbox is always open."
      />
      <Reveal>
        <div className="gradient-border grid overflow-hidden rounded-3xl glass-strong md:grid-cols-5">
          {/* Info panel */}
          <div className="flex flex-col gap-6 border-b border-white/5 bg-gradient-to-br from-purple-600/20 to-blue-600/10 p-6 sm:p-8 md:col-span-2 md:border-b-0 md:border-r">
            <div>
              <h3 className="font-display text-xl font-semibold">Get in touch</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                I usually reply within 24 hours.
              </p>
            </div>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href={`mailto:${profile.email}`}
                  className="flex items-center gap-3 text-white/80 transition-colors hover:text-white"
                >
                  <Mail className="h-4 w-4 text-purple-300" />
                  {profile.email}
                </a>
              </li>
              <li className="flex items-center gap-3 text-white/80">
                <MapPin className="h-4 w-4 text-blue-300" />
                {profile.location}
              </li>
            </ul>
            <div className="mt-auto flex gap-3">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="rounded-full glass p-2.5 transition-colors hover:bg-white/10"
                >
                  <s.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 p-6 sm:p-8 md:col-span-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="contact-name" className={label}>Name</label>
                <input
                  id="contact-name"
                  name="name"
                  required
                  autoComplete="name"
                  className={field}
                  placeholder="Your name"
                  value={form.name}
                  onChange={update("name")}
                />
              </div>
              <div>
                <label htmlFor="contact-email" className={label}>Email</label>
                <input
                  id="contact-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className={field}
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={update("email")}
                />
              </div>
            </div>
            <div>
              <label htmlFor="contact-message" className={label}>Message</label>
              <textarea
                id="contact-message"
                name="message"
                required
                rows={5}
                className={`${field} resize-none`}
                placeholder="Tell me about your project…"
                value={form.message}
                onChange={update("message")}
              />
            </div>
            <motion.button
              type="submit"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              disabled={status === "sent"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-3.5 font-semibold text-white shadow-[0_0_30px_rgba(168,85,247,0.35)] transition-shadow hover:shadow-[0_0_45px_rgba(168,85,247,0.6)] disabled:opacity-80"
            >
              {status === "sent" ? (
                <>
                  <Check className="h-4 w-4" /> Message sent!
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Send Message
                </>
              )}
            </motion.button>
            <p className="sr-only" aria-live="polite">
              {status === "sent" ? "Your message has been sent." : ""}
            </p>
          </form>
        </div>
      </Reveal>
    </Section>
  );
}
