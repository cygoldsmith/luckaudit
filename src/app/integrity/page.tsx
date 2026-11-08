import { redirect } from "next/navigation";

/** Integrity search was split into Compare markets and Method. */
export default function IntegrityRedirect() {
  redirect("/compare");
}
