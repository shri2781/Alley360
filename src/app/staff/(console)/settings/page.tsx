import Link from "next/link";
import styles from "./settings.module.css";

const MENU = [
  { href: "/staff/settings/timings", title: "Alley Timings", subtitle: "Opening hours for each day of the week" },
  { href: "/staff/settings/pricing", title: "Pricing", subtitle: "Base rate, special rates, and this week's preview" },
  { href: "/staff/settings/lanes", title: "Lanes", subtitle: "Add lanes or take them out of rotation" },
  { href: "/staff/settings/password", title: "Change Password", subtitle: "Update the shared staff login" },
] as const;

export default function SettingsPage() {
  return (
    <div>
      <h1 className={styles.title}>Settings</h1>

      <div className={styles.menu}>
        {MENU.map((item) => (
          <Link key={item.href} href={item.href} className={styles.menuRow}>
            <span className={styles.menuText}>
              <span className={styles.menuTitle}>{item.title}</span>
              <span className={styles.menuSubtitle}>{item.subtitle}</span>
            </span>
            <span className={styles.menuChevron} aria-hidden="true">
              &rsaquo;
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
