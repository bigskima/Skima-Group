import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ZodType } from "zod";

import { useSession } from "@lpg/app/providers/SessionProvider";
import { ActionResponseSchema, type ActionResult } from "./records";

export interface GatewayCommand {
  readonly path: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function useGatewayMutation<TData, TVariables extends object>(
  options: {
    readonly invalidate?: readonly (readonly unknown[])[];
    readonly onSuccess?: (result: TData) => void | Promise<void>;
    readonly path: string;
    readonly schema: ZodType<TData>;
  },
) {
  const session = useSession();
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables>({
    mutationFn: (payload) => session.api.post(options.path, payload, options.schema),
    onSuccess: async (result) => {
      for (const key of options.invalidate ?? []) {
        await queryClient.invalidateQueries({ queryKey: ["lpg-mobile", ...key] });
      }
      await options.onSuccess?.(result);
    },
  });
}

export function useGatewayCommandMutation(options: {
  readonly onSuccess?: (result: ActionResult) => void | Promise<void>;
} = {}) {
  const session = useSession();
  const queryClient = useQueryClient();

  return useMutation<ActionResult, Error, GatewayCommand>({
    mutationFn: (command) => session.api.post(
      command.path,
      command.payload,
      ActionResponseSchema,
    ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["lpg-mobile"] });
      await options.onSuccess?.(result);
    },
  });
}

export function mutationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}
