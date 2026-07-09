import { getSupabaseServer } from "../../../../lib/supabase/server";
import Performance from "../Performance";

export const dynamic = "force-dynamic";

export default async function OrganicTab({ params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const { data: detail } = await supabase.from("v_client_report_detail").select("*").eq("slug", slug);

  return <Performance detail={detail} only={["ga4", "pages", "seo"]} showHighlights={false} />;
}
