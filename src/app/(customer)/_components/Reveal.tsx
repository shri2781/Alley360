"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Reveal.module.css";

type RevealProps = {
  children: React.ReactNode;
  as?: "div" | "section";
  delayMs?: number;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">;

/** Fades and rises a section into place the first time it enters the viewport.
 *  A no-op under prefers-reduced-motion (the CSS transition duration is zeroed
 *  globally in customer-theme.module.css, so this only ever toggles a class). */
export function Reveal({ children, as: Tag = "div", delayMs = 0, className, ...rest }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={`${styles.reveal} ${visible ? styles.visible : ""} ${className ?? ""}`}
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
