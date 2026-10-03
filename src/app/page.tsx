import { auth } from "@/auth";
import LandingPage from "@/components/landing/LandingPage";
import { landingFor } from "@/lib/auth/landing";

export default async function Page() {
  // A signed-in visitor gets a direct link to their own dashboard instead of the login button.
  const session = await auth();
  return <LandingPage dashboardHref={session?.user ? landingFor(session.user.role) : null} />;
}
