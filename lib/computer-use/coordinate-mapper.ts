import type { DesktopBounds } from "./types";
export interface DisplaySpace { id: string; dipBounds: DesktopBounds; scaleFactor: number; physicalOrigin?: { x: number; y: number } }
export class DesktopCoordinateMapper {
  constructor(private displays: DisplaySpace[]) { if (!displays.length) throw new Error("At least one display is required"); }
  update(displays: DisplaySpace[]) { if (!displays.length) throw new Error("At least one display is required"); this.displays = displays; }
  dipToPhysical(point: { x: number; y: number }) {
    const display = this.displays.find(d => point.x >= d.dipBounds.x && point.x < d.dipBounds.x + d.dipBounds.width && point.y >= d.dipBounds.y && point.y < d.dipBounds.y + d.dipBounds.height);
    if (!display) throw new RangeError("Point is outside configured displays");
    return { x: (display.physicalOrigin?.x ?? display.dipBounds.x * display.scaleFactor) + (point.x - display.dipBounds.x) * display.scaleFactor, y: (display.physicalOrigin?.y ?? display.dipBounds.y * display.scaleFactor) + (point.y - display.dipBounds.y) * display.scaleFactor };
  }
  physicalToDip(point: { x: number; y: number }, displayId: string) {
    const display = this.displays.find(d => d.id === displayId); if (!display) throw new RangeError("Unknown display");
    const origin = display.physicalOrigin ?? { x: display.dipBounds.x * display.scaleFactor, y: display.dipBounds.y * display.scaleFactor };
    return { x: display.dipBounds.x + (point.x - origin.x) / display.scaleFactor, y: display.dipBounds.y + (point.y - origin.y) / display.scaleFactor };
  }
}
