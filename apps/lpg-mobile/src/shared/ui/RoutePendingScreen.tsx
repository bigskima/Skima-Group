import { ClipboardList } from "lucide-react";

import { PageHeading, PolishedEmpty } from "./lpgComponents";

export function RoutePendingScreen(props: {
  readonly title: string;
  readonly onBack?: () => void;
}) {
  return (
    <>
      <PageHeading title={props.title} />
      <PolishedEmpty
        icon={<ClipboardList />}
        title="No record selected"
        message="Open this step from an active record so Skima can load its backend state."
        actionLabel={props.onBack ? "Go Back" : undefined}
        onAction={props.onBack}
      />
    </>
  );
}
