export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
  kind?: "driver" | "destination" | "pickup" | "station" | "location";
}
export interface OperationalMapProps {
  points: readonly MapPoint[];
  connectPoints?: boolean;
  height?: number;
  initialZoom?: number;
  maxZoom?: number;
  minZoom?: number;
  onSelectPoint?: (point: { latitude: number; longitude: number }) => void;
}
export function OperationalMap(props: OperationalMapProps): React.JSX.Element;
