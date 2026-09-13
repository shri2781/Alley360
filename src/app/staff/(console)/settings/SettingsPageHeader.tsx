import Link from "next/link";
import styles from "./settings.module.css";

export function SettingsPageHeader({
  title,
  description,
  error,
  success,
}: {
  title: string;
  description?: string;
  error?: string;
  success?: string;
}) {
  return (
    <>
      <Link href="/staff/settings" className={styles.backLink}>
        &lsaquo; Settings
      </Link>
      <h1 className={styles.title}>{title}</h1>
      {description && <p className={styles.pageDescription}>{description}</p>}
      {error && <p className={styles.errorBanner}>{error}</p>}
      {success && <p className={styles.successBanner}>{success}</p>}
    </>
  );
}
