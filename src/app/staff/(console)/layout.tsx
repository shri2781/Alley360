import type { Metadata } from "next";
import { requireStaff } from "../../../server/auth/dal";
import { StaffNav } from "./StaffNav";
import styles from "./staff-layout.module.css";

export const metadata: Metadata = {
  title: "Staff Console",
  description: "Staff lane dashboard for the bowling scheduler",
};

/** Gates every page under this route group. This is the second of three layers --
 *  see proxy.ts (optimistic, cookie-only) and the guard at the top of every
 *  mutating Server Action (the actual boundary; a layout gate alone doesn't stop
 *  a Server Action from being called directly). This layer exists to catch
 *  anything that reaches here without going through proxy, and to apply the
 *  is_active database check that proxy deliberately skips. */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();

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
