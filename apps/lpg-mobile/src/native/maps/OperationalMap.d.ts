export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
  kind?: "driver" | "destination" | "pickup" | "station" | "location";
}
export function OperationalMap(props: { points: readonly MapPoint[]; connectPoints?: boolean }): React.JSX.Element;
