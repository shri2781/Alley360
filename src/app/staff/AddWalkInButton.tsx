"use client";

import { useEffect, useState } from "react";
import { addWalkIn } from "./actions";
import styles from "./addWalkIn.module.css";

export function AddWalkInButton({ error }: { error?: string }) {
  const [open, setOpen] = useState(Boolean(error));

  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);

  return (
    <>
      <button type="button" className={styles.addButton} onClick={() => setOpen(true)}>
        + Add
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Add Walk-in</h2>

            <form action={addWalkIn} className={styles.form}>
              {error && <div className={styles.errorNote}>{error}</div>}

              <label className={styles.field}>
                Players
                <input type="number" name="players" min={1} max={24} defaultValue={4} required className={styles.input} />
              </label>
              <label className={styles.field}>
                Games
                <input type="number" name="games" min={1} max={5} defaultValue={2} required className={styles.input} />
              </label>
              <label className={styles.field}>
                Name (optional)
                <input type="text" name="customerName" className={styles.input} />
              </label>

              <div className={styles.actions}>
                <button type="button" className={styles.cancelButton} onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.submitButton}>
                  Add &amp; Start Walk-in
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
