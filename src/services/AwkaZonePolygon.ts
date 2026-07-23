/**
 * DEPRECATED COMPATIBILITY WRAPPER
 * All geography capabilities are now powered by GeographyEngine.ts.
 * Zero hardcoded location files.
 */

import { GeographyEngine } from './GeographyEngine';

export class AwkaZonePolygon {
  public static isPointInPolygon(point: { lat: number; lng: number }, polygon: Array<{ lat: number; lng: number }>): boolean {
    return GeographyEngine.isPointInPolygon(point, polygon);
  }

  public static resolveZone(coords: { lat: number; lng: number }) {
    return GeographyEngine.resolveZone(coords);
  }

  public static getZoneSurgeMultiplier(coords: { lat: number; lng: number }): number {
    return GeographyEngine.getZoneSurgeMultiplier(coords);
  }

  public static getAllZones() {
    return GeographyEngine.getRegisteredPolygons().map(p => ({
      id: p.id,
      name: p.label,
      districtCode: p.id,
      surgeMultiplier: p.surgeMultiplier,
      centerCoordinates: p.coordinates[0] || { lat: 6.22, lng: 7.07 },
      boundingPolygon: p.coordinates,
    }));
  }
}
