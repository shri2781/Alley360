import Link from "next/link";
import { formatWeekSummary, type WeeklyHours } from "../../../domain/hours";
import styles from "./SiteFooter.module.css";

export function SiteFooter({ venueName, weeklyHours }: { venueName: string; weeklyHours: WeeklyHours }) {
  const hours = formatWeekSummary(weeklyHours);

  return (
    <footer id="contact" className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.name}>{venueName}</span>
          <span className={styles.hours}>{hours}</span>
        </div>

        <div className={styles.info}>
          <a href="https://maps.google.com/?q=Chennai" target="_blank" rel="noopener noreferrer" className={styles.infoLink}>
            Chennai
          </a>
          <a href="tel:+911234567890" className={styles.infoLink}>
            +91 1234567890
          </a>
        </div>

        <Link href="/book" className={styles.cta}>
          Book Your Lane &rsaquo;
        </Link>
      </div>

      <div className={styles.bottom}>
        <span>&copy; {new Date().getFullYear()} {venueName}</span>
        <a href="#top" className={styles.top}>
          Back to top &uarr;
        </a>
      </div>
    </footer>
  );
}
