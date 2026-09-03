"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./staff-layout.module.css";

const LINKS = [
  { href: "/staff", label: "Lane Allotment" },
  { href: "/staff/bookings", label: "Bookings" },
  { href: "/staff/walk-ins", label: "Walk-ins" },
  { href: "/staff/settings", label: "Settings" },
];

export function StaffNav() {
  const pathname = usePathname();

  return (
    <ul className={styles.nav}>
      {LINKS.map((link) => {
        // Exact match for "/staff" itself, prefix match for sub-routes -- otherwise
        // "/staff" would stay highlighted while viewing "/staff/bookings" too.
        const active = link.href === "/staff" ? pathname === "/staff" : pathname.startsWith(link.href);
        return (
          <li key={link.href}>
            <Link href={link.href} className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}>
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
