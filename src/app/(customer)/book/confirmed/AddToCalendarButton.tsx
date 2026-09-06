"use client";

import btn from "../../_components/Button.module.css";

function icsTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Builds a minimal .ics file client-side from data already on the booking row
 *  (scheduledStart + estimatedPlayMin) and hands it to the browser as a download --
 *  no server round-trip, no new data invented. */
export function AddToCalendarButton({
  venueName,
  startIso,
  endIso,
  description,
}: {
  venueName: string;
  startIso: string;
  endIso: string;
  description: string;
}) {
  function handleClick() {
    const start = icsTimestamp(new Date(startIso));
    const end = icsTimestamp(new Date(endIso));
    const stamp = icsTimestamp(new Date());
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//" + venueName.replace(/[\r\n]/g, " ") + "//Booking//EN",
      "BEGIN:VEVENT",
      `UID:${stamp}-booking@${venueName.replace(/[^a-z0-9]/gi, "").toLowerCase() || "booking"}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:Bowling at ${venueName}`,
      `DESCRIPTION:${description.replace(/[\r\n]/g, " ")}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bowling-booking.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className={btn.btnGhost} onClick={handleClick}>
      Add to Calendar
    </button>
  );
}
