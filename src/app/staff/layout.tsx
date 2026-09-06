import type { Metadata } from "next";
import { StaffNav } from "./StaffNav";
import styles from "./staff-layout.module.css";

export const metadata: Metadata = {
  title: "Staff Console",
  description: "Staff lane dashboard for the bowling scheduler",
};

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>Staff Console</div>
        <StaffNav />
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
