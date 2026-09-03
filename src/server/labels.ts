/** A nameless booking isn't necessarily a walk-in -- an online booking with no name
 *  entered is still an online booking. Only the literal 'walkin' source gets that label. */
export function displayName(
  customerName: string | null,
  source: "walkin" | "phone" | "staff" | "web",
): string {
  if (customerName) return customerName;
  return source === "walkin" ? "Walk-in" : "Guest";
}
