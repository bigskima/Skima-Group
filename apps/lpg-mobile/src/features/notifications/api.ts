import { RecordArraySchema } from "../../shared/api/records";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useMessagesQuery() {
  return useGatewayQuery({
    key: ["messages"],
    path: "/runtime/communications/messages",
    schema: RecordArraySchema,
  });
}
