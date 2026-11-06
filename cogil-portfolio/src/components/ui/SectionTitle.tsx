import { Reveal } from "./Reveal";

export function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <Reveal className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
      <span className="mb-4 inline-block rounded-full glass px-4 py-1 text-xs font-medium uppercase tracking-[0.2em] text-purple-300">
        {eyebrow}
      </span>
      <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base text-white/60 sm:text-lg">{description}</p>
      )}
    </Reveal>
  );
}
