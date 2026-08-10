import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

const DraftSchema = z.object({
  version: z.number().int().positive(),
  type: z.string().min(1),
  ownerProfileId: z.string().min(1),
  workflowId: z.string().optional(),
  step: z.string().min(1),
  values: z.record(z.unknown()),
  pendingMedia: z
    .array(z.object({ uri: z.string(), purpose: z.string() }))
    .default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WorkflowDraft = z.infer<typeof DraftSchema>;
const key = (owner: string, type: string) => `skima:draft:v1:${owner}:${type}`;

export const draftStore = {
  async load(owner: string, type: string): Promise<WorkflowDraft | null> {
    const value = await AsyncStorage.getItem(key(owner, type));
    if (!value) return null;
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch {
      await AsyncStorage.removeItem(key(owner, type));
      return null;
    }
    const parsed = DraftSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.version !== 1) {
      await AsyncStorage.removeItem(key(owner, type));
      return null;
    }
    return parsed.data;
  },
  async save(draft: WorkflowDraft) {
    const existing = await this.load(draft.ownerProfileId, draft.type);
    const validated = DraftSchema.parse({
      ...draft,
      createdAt: existing?.createdAt ?? draft.createdAt,
    });
    await AsyncStorage.setItem(
      key(draft.ownerProfileId, draft.type),
      JSON.stringify(validated),
    );
  },
  clear: (owner: string, type: string) =>
    AsyncStorage.removeItem(key(owner, type)),
};
