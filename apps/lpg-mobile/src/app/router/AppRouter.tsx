import { AuthenticationGuard } from "../guards/AuthenticationGuard";
import { AuthenticatedRouter } from "./AuthenticatedRouter";
import { PublicRouter } from "./PublicRouter";

export function AppRouter() {
  return (
    <AuthenticationGuard publicExperience={<PublicRouter />}>
      {(context) => <AuthenticatedRouter context={context} />}
    </AuthenticationGuard>
  );
}
