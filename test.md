# Testing plan and checklist

## Commands

| Command | Category | Purpose |
| --- | --- | --- |
| `npm test` | Unit / security | Fast, isolated checks of domain rules and auth helpers. |
| `npm run bench` | Performance benchmark | Measures scheduler throughput on a dense 12-lane fixture; informational, not a pass/fail latency gate. |
| `npm run typecheck` | Static validation | Verifies TypeScript types without emitting build output. |
| `npm run prove:constraint` | Manual database proof | Verifies PostgreSQL's overlap exclusion constraint against a running local database. |
| `npm run booking:demo` | Manual service integration proof | Exercises booking, session, cancellation, and blocking against a running local database. |

## Existing automated coverage

### Unit — domain

- Duration estimation: grid rounding, minimum allocation size, and invalid player/game counts.
- Availability scheduler: candidate window, packing preference, overlaps, opening/closing bounds, exact-slot validation, and staff move validation.
- Venue time helpers: timezone conversion, business-date rollover, and post-midnight operations.

### Unit — security

- Password hashing and malformed-password-hash handling.
- Signed staff-session token validity, tampering, expiry, and malformed token rejection.
- Login-attempt rate-limit threshold, successful-login reset, and lock expiry.
- Customer booking validation: malformed date/time, invalid party sizes, malformed phone numbers, and names containing emoji, markup, digits, or control characters.
- Booking lifecycle: a started booking is immutable and a released booking cannot be moved.

### Performance benchmark

- Candidate search with 12 lanes and 144 existing allocations, representing a densely scheduled day.

## Required checks before deployment

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes in the target deployment environment.
- [ ] An isolated PostgreSQL database is reset and seeded successfully.
- [ ] `npm run prove:constraint` passes.
- [ ] `npm run booking:demo` passes.
- [ ] A customer can search availability, select a time, submit valid details, and view confirmation.
- [ ] A stale selected slot returns a clear unavailable message and does not create a booking.
- [ ] An unauthenticated user is redirected from every `/staff` page and cannot complete a staff mutation.
- [ ] A valid staff user can sign in, add a walk-in, start/end/cancel a booking, and sign out.
- [ ] A production-like test confirms concurrent booking attempts for the same lane/time leave exactly one confirmed allocation.

## Planned integration tests

These should run against an ephemeral PostgreSQL database, never a shared development database.

- [ ] Schema constraints: overlapping, back-to-back, released, malformed, and cross-lane allocation ranges.
- [ ] Booking lifecycle: create, exact-slot booking, cancellation, maintenance block, start, end, and multi-lane lifecycle.
- [ ] Transaction rollback: no orphaned booking, allocation, or session records after a failed write.
- [ ] Concurrency: simultaneous exact-slot requests result in one success and one conflict/unavailable outcome.
- [ ] Timeline and bookings-list queries: overnight venue hours, clipping, grouping, lane ordering, and inactive lanes.

## Planned end-to-end tests

Next.js recommends browser E2E coverage for async Server Components and complete user flows. Add Playwright when these are implemented.

- [ ] Customer booking happy path and validation failures.
- [ ] Staff login, invalid password, rate-limit message, and expired/inactive session behavior.
- [ ] Staff walk-in, timeline move rejection, booking start/end/cancel, and settings edits.
- [ ] Keyboard and mobile checks for booking and staff forms.

## Regression policy

- Every bug fix receives a focused automated test at the lowest meaningful layer.
- Unit, integration, typecheck, and production-build checks run on every pull request.
- Browser E2E tests run before releases and after changes to booking, authentication, or staff actions.
- Benchmark trends are reviewed when scheduling or database-query logic changes; regressions are investigated rather than enforced through a fragile fixed timing threshold.
