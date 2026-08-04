import type { ReactNode } from "react";

export interface WorkspaceTab<TTab extends string> {
  readonly key: TTab;
  readonly label: string;
  readonly icon: ReactNode;
  readonly center?: boolean;
}

export interface NestedNavigator<TRoute extends string> {
  readonly route: TRoute;
  readonly params: Readonly<Record<string, string>>;
  readonly canGoBack: boolean;
  readonly navigate: (route: TRoute, params?: Readonly<Record<string, string>>) => void;
  readonly replace: (route: TRoute, params?: Readonly<Record<string, string>>) => void;
  readonly goBack: () => void;
}
