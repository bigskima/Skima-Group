import { useLocalSearchParams } from "expo-router";
import { StationDetailScreen } from "../../../src/native/ui/StationDetailScreen";
export default function StationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StationDetailScreen id={id ?? null} />;
}
