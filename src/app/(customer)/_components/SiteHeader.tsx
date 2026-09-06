"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./SiteHeader.module.css";

const NAV_LINKS = [
  { href: "/#home", label: "Home" },
  { href: "/#packages", label: "Packages" },
  { href: "/#how-it-works", label: "How it Works" },
  { href: "/#faq", label: "FAQ" },
];

/** Sticky site nav. Transparent over a hero, solid once the page scrolls past it.
 *  The mobile menu is a real disclosure (button + panel), not the checkbox hack the
 *  landing page used before -- that pattern can't be operated from a keyboard. */
export function SiteHeader({ venueName }: { venueName: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the drawer on route change (e.g. tapping "Book Now" navigates to /book).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className={`${styles.header} ${scrolled ? styles.scrolled : ""}`}>
      <div className={styles.bar}>
        <Link href="/" className={styles.logo}>
          {venueName}
        </Link>

        <nav className={styles.navDesktop} aria-label="Primary">
          <ul>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <Link href="/book" className={styles.cta}>
          Book Now
        </Link>

        <button
          ref={toggleRef}
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`${styles.bun} ${open ? styles.bunOpen : ""}`} aria-hidden="true" />
        </button>
      </div>

      <div id="mobile-nav" className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`} hidden={!open}>
        <ul>
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <Link href="/book" className={styles.drawerCta} onClick={() => setOpen(false)}>
              Book Now
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}
