import { MM20_DATASHEET, MM20_FEATURES, MM20_MECH } from "../sources/knowles-mm20";

/** Identity and manufacturer-published package facts for the reference microphone. */
export const MM20 = {
  id: "mm20",
  name: "Knowles MM20",
  partNumber: "MM20-33366-B116",
  manufacturer: "Knowles Electronics, LLC",
  datasheetSourceId: MM20_DATASHEET.id,
  /** Published description (sheet 1): 'an acoustic sensor, a low noise input buffer, and an output amplifier'. */
  summary:
    "Miniature, low-power, bottom-port silicon (MEMS) microphone. Per the datasheet it consists of an acoustic sensor, a low noise input buffer, and an output amplifier.",
  summarySourceId: MM20_FEATURES.id,
  /** Outer package envelope, millimetres, from the mechanical drawing (tolerance ±0.080 mm on each). */
  package: {
    length: 3.35,
    width: 2.5,
    height: 1.3,
    toleranceMm: 0.08,
    sourceId: MM20_MECH.id,
  },
  /** Port-hole circle diameters shown in the mechanical drawing (±0.050 mm). Role of each ring is not stated. */
  portRingDiametersMm: [0.45, 0.97, 1.478],
  /** Port centre in the drawing (centre of ground ring), ±0.100 mm: 1.250 from the side edge, 1.080 from the top edge. */
  portCentreMm: { fromSideEdge: 1.25, fromTopEdge: 1.08 },
} as const;
