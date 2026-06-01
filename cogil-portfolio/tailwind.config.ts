import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        neon: {
          purple: "#a855f7",
          blue: "#3b82f6",
          cyan: "#22d3ee",
        },
        navy: {
          900: "#070a1a",
          800: "#0b1027",
          700: "#111733",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      animation: {
        "aurora-1": "aurora1 18s ease-in-out infinite",
        "aurora-2": "aurora2 22s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "shimmer": "shimmer 2.5s linear infinite",
        "glow-pulse": "glowPulse 4s ease-in-out infinite",
      },
      keyframes: {
        aurora1: {
          "0%,100%": { transform: "translate(-10%,-10%) scale(1)" },
          "50%": { transform: "translate(10%,15%) scale(1.25)" },
        },
        aurora2: {
          "0%,100%": { transform: "translate(15%,10%) scale(1.1)" },
          "50%": { transform: "translate(-12%,-8%) scale(1.3)" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-16px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        glowPulse: {
          "0%,100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
