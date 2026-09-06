import { getStaffUser } from "../../../server/auth/dal";
import { getVenue } from "../../../server/venue";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

/** Public route -- outside the (console) route group, so it does NOT go through
 *  StaffLayout's requireStaff() gate (that would redirect this page to itself).
 *  Bounces an already-logged-in visitor straight through instead of showing the
 *  form again. */
export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/staff") && !next.startsWith("//") ? next : "/staff";

  const user = await getStaffUser();
  if (user) {
    redirect(safeNext);
  }

  const venue = await getVenue();

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{venue.name}</h1>
        <p className={styles.subtitle}>Staff Console</p>
        <LoginForm next={safeNext} />
      </div>
    </div>
  );
}
