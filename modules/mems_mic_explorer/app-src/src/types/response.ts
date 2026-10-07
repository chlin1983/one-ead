import type { Confidence } from "./evidence";

// Phase 2 will populate curves; the type is defined now so the data architecture is stable.
export interface ResponseCurve {
  id: string;
  name: string;
  microphoneId: string;
  curveType: "manufacturer_published" | "measured" | "conceptual";
  frequencyUnit: "Hz";
  amplitudeUnit: "dB";
  points: { frequency: number; level: number }[];
  source?: string;
  sourceFigure?: string;
  sourcePage?: number;
  extractionMethod?: "digital_data" | "manual_digitization" | "approximation";
  confidence: Confidence;
}

/** A region / feature of a frequency-response curve (curve anatomy, Phase 2). */
export interface ResponseFeature {
  id: string;
  label: string;
  description: string;
}
