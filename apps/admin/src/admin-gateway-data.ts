import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useSessionState } from "./session";

const RecordSchema = z.record(z.unknown());
const RecordArraySchema = z.array(RecordSchema);

export type PlatformRecord = Readonly<Record<string, unknown>>;

export function useGatewayRecords(queryKey: string, path: string, enabled = true) {
  return useGatewayData(queryKey, path, RecordArraySchema, enabled);
}

export function useGatewayData<TData>(
  queryKey: string,
  path: string,
  schema: z.ZodType<TData>,
  enabled = true,
) {
  const { api, status } = useSessionState();

  return useQuery({
    queryKey: ["gateway", queryKey, path],
    queryFn: () => api.get(path, schema),
    enabled: status === "authenticated" && enabled,
  });
}

export function getRecordString(
  record: PlatformRecord | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function firstName(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized.split(/\s+/)[0] : "there";
}
