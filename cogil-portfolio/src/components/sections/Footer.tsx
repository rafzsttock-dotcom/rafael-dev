import { navLinks, profile, socials } from "@/lib/data";

export function Footer() {
  return (
    <footer className="border-t border-white/5 px-5 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 md:flex-row md:justify-between">
        <a href="#" className="font-display text-lg font-bold">
          {profile.name.toLowerCase()}
          <span className="text-purple-400">.</span>
        </a>
        <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-white/50 transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex gap-3">
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
      <p className="mt-8 text-center text-xs text-white/35">
        © {new Date().getFullYear()} {profile.name}. All rights reserved.
      </p>
    </footer>
  );
}
