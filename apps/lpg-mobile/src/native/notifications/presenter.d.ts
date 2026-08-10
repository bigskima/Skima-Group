export function presentBackendNotification(input: {
  title: string;
  body: string;
  path?: string;
}): Promise<void>;
