"use client";

import { useEffect, useRef } from "react";

function Particles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let raf = 0;
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const count = Math.min(60, Math.floor(w / 24));
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.6 + 0.4,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(168, 85, 247, 0.5)";
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };

    if (!reduced) {
      draw();
      window.addEventListener("resize", onResize);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-50"
      aria-hidden
    />
  );
}

export function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
      {/* Aurora blobs */}
      <div className="absolute left-1/4 top-1/4 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-purple-600/30 blur-[140px] animate-aurora-1" />
      <div className="absolute right-1/4 top-1/3 h-[36rem] w-[36rem] translate-x-1/2 rounded-full bg-blue-600/25 blur-[140px] animate-aurora-2" />
      <div className="absolute bottom-0 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-cyan-500/20 blur-[120px] animate-aurora-1" />

      {/* Grid */}
      <div className="absolute inset-0 grid-pattern" />

      {/* Particles */}
      <Particles />

      {/* Noise */}
      <div className="absolute inset-0 noise-overlay" />
    </div>
  );
}
