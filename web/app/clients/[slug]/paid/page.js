import { getSupabaseServer } from "../../../../lib/supabase/server";
import Performance from "../Performance";
import Campaigns from "../Campaigns";

export const dynamic = "force-dynamic";

export default async function PaidTab({ params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const [{ data: detail }, { data: campaigns }] = await Promise.all([
    supabase.from("v_client_report_detail").select("*").eq("slug", slug),
    supabase.from("v_client_campaigns").select("*").eq("slug", slug),
  ]);

  return (
    <>
      <Performance detail={detail} only={["google_ads", "meta"]} showHighlights={false} />
      <Campaigns campaigns={campaigns} />
    </>
  );
}
