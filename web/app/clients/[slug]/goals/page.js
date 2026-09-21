import { redirect } from "next/navigation";

// Goals moved into the single Manage page (tabs). Kept so old links and bookmarks still land.
export default function GoalsMoved({ params }) {
  redirect(`/clients/${encodeURIComponent(decodeURIComponent(params.slug))}/manage#goals`);
}
