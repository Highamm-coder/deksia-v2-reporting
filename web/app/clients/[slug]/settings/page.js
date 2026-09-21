import { redirect } from "next/navigation";

// Settings moved into the single Manage page (tabs). Kept so old links and bookmarks still land.
export default function SettingsMoved({ params }) {
  redirect(`/clients/${encodeURIComponent(decodeURIComponent(params.slug))}/manage#settings`);
}
