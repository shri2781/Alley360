import { StaffNav } from "./StaffNav";
import styles from "./staff-layout.module.css";

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
