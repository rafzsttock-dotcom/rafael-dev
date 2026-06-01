# Cogil — Premium Portfolio

Modern, futuristic personal portfolio built with **Next.js 15 (App Router)**, **TypeScript**, **TailwindCSS**, and **Framer Motion**.

## Features
- Animated aurora + grid + particle + noise background
- Hero with typewriter animation & floating glass card
- Animated count-up stats
- About, Skills (progress + hover glow), Bento-grid Projects with tilt
- Vertical experience timeline (line-grow animation)
- Auto-rotating testimonials carousel
- Glass contact form + minimal footer
- Magnetic buttons, scroll reveals, parallax
- SEO: metadata, OpenGraph, Twitter card, sitemap, robots
- Fully responsive, dark theme default, reduced-motion friendly

## Getting Started
```bash
npm install
npm run dev
```
Open http://localhost:3000

## Build
```bash
npm run build && npm start
```

## Customize
- Content: `src/lib/data.ts`
- Name / hero text: `src/components/sections/Hero.tsx`
- Theme colors: `tailwind.config.ts` and `src/app/globals.css`
- SEO / site URL: `src/app/layout.tsx`, `sitemap.ts`, `robots.ts`

## Notes
- Uses `Sora` (display) + `Manrope` (body) via `next/font/google`.
- The contact form is front-end only — wire `handleSubmit` in `Contact.tsx` to your API/email service.
