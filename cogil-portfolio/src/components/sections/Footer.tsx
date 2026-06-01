import { Github, Twitter, Linkedin } from "lucide-react";

const socials = [
  { icon: Github, href: "https://github.com", label: "GitHub" },
  { icon: Twitter, href: "https://twitter.com", label: "Twitter" },
  { icon: Linkedin, href: "https://linkedin.com", label: "LinkedIn" },
];

export function Footer() {
  return (
    <footer className="border-t border-white/5 px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 sm:flex-row">
        <a href="#" className="font-display text-lg font-bold">
          cogil<span className="text-purple-400">.</span>
        </a>
        <div className="flex gap-3">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              aria-label={s.label}
              className="rounded-full glass p-2.5 transition-colors hover:bg-white/10"
            >
              <s.icon className="h-4 w-4" />
            </a>
          ))}
        </div>
        <p className="text-sm text-white/40">
          © {new Date().getFullYear()} Cogil. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
