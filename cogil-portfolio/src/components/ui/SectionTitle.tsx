import { Reveal } from "./Reveal";

export function SectionTitle({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <Reveal className="mb-14 text-center">
      <span className="mb-3 inline-block rounded-full glass px-4 py-1 text-xs font-medium uppercase tracking-[0.2em] text-purple-300">
        {eyebrow}
      </span>
      <h2 className="font-display text-3xl font-bold sm:text-4xl md:text-5xl">
        {title}
      </h2>
    </Reveal>
  );
}
