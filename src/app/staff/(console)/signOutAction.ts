"use server";

import { redirect } from "next/navigation";
import { destroySession } from "../../../server/auth/session";

export async function signOut() {
  await destroySession();
  redirect("/staff/login");
}
