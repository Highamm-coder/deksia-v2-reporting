import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Refreshes the auth session on every request and gates everything behind login.
export async function updateSession(request) {
  let res = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          res = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // public auth routes: login, deksia-domain signup, reset request, email-link callback.
  // /reset/update stays protected — setting a new password requires the recovery session.
  const isPublic =
    ["/login", "/signup", "/reset", "/auth/callback"].some((p) => path === p || path.startsWith(p + "/")) &&
    !(path === "/reset/update" || path.startsWith("/reset/update/"));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return res;
}
