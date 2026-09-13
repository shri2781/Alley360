import { changePassword } from "../actions";
import { SettingsPageHeader } from "../SettingsPageHeader";
import styles from "../settings.module.css";

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;

  return (
    <div>
      <SettingsPageHeader
        title="Change Password"
        description="The shared login everyone on shift uses to open this console. Changing it only affects future sign-ins."
        error={error}
        success={success}
      />

      <section className={styles.section}>
        <form action={changePassword} className={styles.passwordForm}>
          <label className={styles.field}>
            Current password
            <input type="password" name="currentPassword" autoComplete="current-password" required className={styles.input} />
          </label>
          <label className={styles.field}>
            New password
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              minLength={8}
              required
              className={styles.input}
            />
          </label>
          <label className={styles.field}>
            Confirm new password
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={8}
              required
              className={styles.input}
            />
          </label>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            Update Password
          </button>
        </form>
      </section>
    </div>
  );
}
