"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import styles from "./login.module.css";

/** useActionState here is a deliberate departure from the rest of the staff
 *  console, which round-trips errors via redirect("/staff?error=...") +
 *  searchParams. That pattern loses whatever the user typed and has no pending
 *  state. For the one form every shift starts with, an inline error and a
 *  disabled "Signing in..." button are worth the inconsistency -- and this is
 *  the framework's own documented shape for a login form. */
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, undefined);

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="next" value={next} />

      <label className={styles.field}>
        Username
        <input type="text" name="username" autoComplete="username" required className={styles.input} autoFocus />
      </label>

      <label className={styles.field}>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className={styles.input}
        />
      </label>

      {state?.error && (
        <div className={styles.errorNote} role="status" aria-live="polite">
          {state.error}
        </div>
      )}

      <button type="submit" className={styles.submitBtn} disabled={pending}>
        {pending ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}
