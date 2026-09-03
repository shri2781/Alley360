import { db } from "../../db/client";
import { tenant } from "../../db/schema";
import { AutoRefresh } from "../../components/AutoRefresh";
import { LaneBoard } from "../../components/LaneBoard";
import { getLaneBoard } from "../../server/queries";

export default async function Page() {
  const [venue] = await db.select().from(tenant).limit(1);

  if (!venue) {
    return (
      <div style={{ padding: 24 }}>
        No venue found. Run <code>npm run db:reset</code> to seed one.
      </div>
    );
  }

  const data = await getLaneBoard(venue.id);

  return (
    <>
      <AutoRefresh />
      <LaneBoard data={data} />
    </>
  );
}
