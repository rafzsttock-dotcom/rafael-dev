import {
  Code2,
  Server,
  Database,
  Cloud,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export const stats = [
  { label: "Projects Completed", value: 150, suffix: "+" },
  { label: "Happy Clients", value: 20, suffix: "+" },
  { label: "Years Experience", value: 5, suffix: "+" },
  { label: "Technologies", value: 50, suffix: "+" },
];

export interface SkillGroup {
  title: string;
  icon: LucideIcon;
  level: number;
  items: string[];
}

export const skills: SkillGroup[] = [
  {
    title: "Frontend",
    icon: Code2,
    level: 95,
    items: ["React", "Next.js", "TypeScript", "Tailwind"],
  },
  {
    title: "Backend",
    icon: Server,
    level: 90,
    items: ["Node.js", "Python", "Go", "GraphQL"],
  },
  {
    title: "Database",
    icon: Database,
    level: 85,
    items: ["PostgreSQL", "Redis", "MongoDB", "Prisma"],
  },
  {
    title: "DevOps",
    icon: Cloud,
    level: 80,
    items: ["Docker", "Kubernetes", "AWS", "CI/CD"],
  },
  {
    title: "Automation",
    icon: Workflow,
    level: 92,
    items: ["n8n", "Telethon", "Bots", "Scraping"],
  },
];

export interface Project {
  title: string;
  description: string;
  stack: string[];
  github: string;
  demo: string;
  gradient: string;
  span: string;
}

export const projects: Project[] = [
  {
    title: "Nebula Dashboard",
    description:
      "Real-time analytics platform processing millions of events with sub-second latency.",
    stack: ["Next.js", "ClickHouse", "WebSocket"],
    github: "https://github.com",
    demo: "https://example.com",
    gradient: "from-purple-600/30 to-blue-600/20",
    span: "md:col-span-2 md:row-span-2",
  },
  {
    title: "Telegram Star Engine",
    description:
      "Automated Stars & Premium purchase flows built on Telethon.",
    stack: ["Python", "Telethon", "TON"],
    github: "https://github.com",
    demo: "https://example.com",
    gradient: "from-cyan-500/30 to-blue-600/20",
    span: "md:col-span-1",
  },
  {
    title: "Quantum Pay",
    description: "Multi-currency payment gateway with fraud detection.",
    stack: ["Go", "Stripe", "Redis"],
    github: "https://github.com",
    demo: "https://example.com",
    gradient: "from-fuchsia-600/30 to-purple-600/20",
    span: "md:col-span-1",
  },
  {
    title: "Aurora CMS",
    description:
      "Headless CMS with edge rendering and AI-assisted content tools.",
    stack: ["Next.js", "Postgres", "OpenAI"],
    github: "https://github.com",
    demo: "https://example.com",
    gradient: "from-blue-600/30 to-indigo-600/20",
    span: "md:col-span-2",
  },
];

export interface Experience {
  role: string;
  company: string;
  period: string;
  description: string;
}

export const experiences: Experience[] = [
  {
    role: "Senior Full Stack Engineer",
    company: "Vertex Labs",
    period: "2023 — Present",
    description:
      "Leading a team building distributed systems and developer tooling at scale.",
  },
  {
    role: "Full Stack Developer",
    company: "Nimbus Studio",
    period: "2021 — 2023",
    description:
      "Shipped 30+ client products across fintech, SaaS, and automation.",
  },
  {
    role: "Automation Engineer",
    company: "Freelance",
    period: "2019 — 2021",
    description:
      "Built bots, scrapers, and workflow automations for global clients.",
  },
];

export interface Testimonial {
  name: string;
  title: string;
  quote: string;
}

export const testimonials: Testimonial[] = [
  {
    name: "Sarah Chen",
    title: "CTO, Vertex Labs",
    quote:
      "One of the most reliable engineers I've worked with. Ships fast without cutting corners.",
  },
  {
    name: "Marcus Rivera",
    title: "Founder, Nimbus",
    quote:
      "Turned a vague idea into a polished product in weeks. Exceptional attention to detail.",
  },
  {
    name: "Aisha Khan",
    title: "PM, Quantum",
    quote:
      "The automation work saved our team hundreds of hours. Truly a force multiplier.",
  },
];
