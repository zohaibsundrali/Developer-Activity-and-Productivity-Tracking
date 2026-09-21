"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Moon, Sun } from "lucide-react";
import styles from "@/app/landing.module.css";

const THEME_KEY = "devtrack.theme";

export function LandingThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const transitionTimer = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setDark(root.classList.contains("dark"));
    const applyPreference = () => {
      let stored;
      try { stored = localStorage.getItem(THEME_KEY); } catch {}
      const next = stored === "dark" || (stored !== "light" && media.matches);
      root.classList.toggle("dark", next);
      root.style.colorScheme = next ? "dark" : "light";
      sync();
    };
    const onStorage = (event) => {
      if (event.key === THEME_KEY || event.key === null) applyPreference();
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    sync();
    setMounted(true);
    media.addEventListener("change", applyPreference);
    window.addEventListener("storage", onStorage);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", applyPreference);
      window.removeEventListener("storage", onStorage);
      clearTimeout(transitionTimer.current);
      root.classList.remove("landing-theme-changing");
    };
  }, []);

  const toggle = () => {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    root.classList.add("landing-theme-changing");
    // Resolve the transition guard before changing any palette values.
    void document.body.offsetHeight;
    root.classList.toggle("dark", next);
    root.style.colorScheme = next ? "dark" : "light";
    // Flush the complete new palette before restoring normal hover transitions.
    void document.body.offsetHeight;
    setDark(next);
    try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch {}
    clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => root.classList.remove("landing-theme-changing"), 50);
  };

  return (
    <button type="button" onClick={toggle} aria-label="Dark mode"
      aria-pressed={mounted ? dark : undefined} title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background xl:ml-0">
      <Moon className="h-5 w-5 dark:hidden" aria-hidden="true" />
      <Sun className="hidden h-5 w-5 dark:block" aria-hidden="true" />
    </button>
  );
}

export function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let frame;
    const read = () => {
      frame = undefined;
      setVisible(window.scrollY > 400);
    };
    const onScroll = () => {
      if (frame === undefined) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  if (!visible) return null;
  return (
    <button type="button" aria-label="Back to top" title="Back to top"
      className={styles.backToTop}
      onClick={() => {
        document.getElementById("landing-home-link")?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }}>
      <ArrowUp className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
