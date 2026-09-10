import { getVenue } from "../../server/venue";
import { SiteFooter } from "./_components/SiteFooter";
import { SiteHeader } from "./_components/SiteHeader";
import styles from "./customer-theme.module.css";

/** Wraps every customer-facing route (/, /book, /book/confirmed) in the dark theme
 *  plus a shared header and footer. Route groups like (customer) add no URL segment --
 *  this only shapes the layout.
 *
 *  Previously this file only applied the theme class, so /book and /book/confirmed had
 *  no nav at all and no way back to the site except the browser's back button. */
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const venue = await getVenue();

  return (
    <div id="top" className={styles.root}>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <SiteHeader venueName={venue.name} />
      <main id="main">{children}</main>
      <SiteFooter venueName={venue.name} weeklyHours={venue.weeklyHours} />
    </div>
  );
}
