import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";
import { z } from "zod";

import { useSession } from "@lpg/app/providers/SessionProvider";
import { createLpgIdempotencyKey, type PlatformRecord } from "@lpg/shared/api/records";

const MediaReadSessionSchema = z.object({
  assetId: z.string().uuid(),
  contentType: z.string().nullable(),
  expiresInSeconds: z.number().positive(),
  signedUrl: z.string().url(),
});

export function RuntimeMediaImage(props: {
  readonly alt: string;
  readonly assetId: string | null;
  readonly fallback?: ReactNode;
}) {
  const session = useSession();
  const query = useQuery({
    enabled: session.status === "authenticated" && Boolean(props.assetId),
    queryFn: () => session.api.post(
      "/runtime/media/read-sessions",
      {
        assetId: props.assetId,
        idempotencyKey: createLpgIdempotencyKey("media-read", props.assetId),
      },
      MediaReadSessionSchema,
    ),
    queryKey: ["lpg-mobile", "media-read", props.assetId],
    staleTime: 12 * 60 * 1000,
  });

  if (query.data?.signedUrl) {
    return <img className="runtime-media-image" src={query.data.signedUrl} alt={props.alt} />;
  }

  return props.fallback ?? (
    <span className="runtime-media-placeholder" aria-label={`${props.alt} unavailable`}>
      <ImageOff aria-hidden="true" />
    </span>
  );
}

export function firstMediaAssetId(record: PlatformRecord | null | undefined): string | null {
  const candidates = [
    record?.image_asset_ids,
    record?.imageAssetIds,
    record?.vehicle_image_asset_ids,
    record?.vehicleImageAssetIds,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const id = candidate.find((value): value is string => typeof value === "string");
      if (id) return id;
    }
  }

  const singleCandidates = [
    record?.logo_asset_id,
    record?.logoAssetId,
    record?.avatar_asset_id,
    record?.avatarAssetId,
    record?.ownership_proof_asset_id,
    record?.ownershipProofAssetId,
    record?.ownership_proof_media_asset_id,
    record?.ownershipProofMediaAssetId,
  ];
  return singleCandidates.find((value): value is string => typeof value === "string") ?? null;
}
