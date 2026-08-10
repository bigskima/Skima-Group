export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
}
export function OperationalMap(props: { points: readonly MapPoint[]; connectPoints?: boolean }): React.JSX.Element;
