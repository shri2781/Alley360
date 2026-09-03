import styles from "./customer-theme.module.css";

/** Wraps every customer-facing route (/, /book, /book/confirmed) in the dark theme.
 *  Route groups like (customer) add no URL segment -- this only shapes the layout. */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.root}>{children}</div>;
}
