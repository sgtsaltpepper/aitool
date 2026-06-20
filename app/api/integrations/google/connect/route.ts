import { redirect } from "next/navigation";

import { getAuthUrl } from "@/lib/integrations/google-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = getAuthUrl();
  redirect(url);
}
