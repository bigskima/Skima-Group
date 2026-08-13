import type { MapPoint } from "../domains/maps";

export type { MapPoint } from "../domains/maps";
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
