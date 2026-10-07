import type { ResponseFeature } from "../../types/response";

// Regions / features of a frequency-response curve. Detailed curve anatomy arrives in Phase 2.
export const RESPONSE_FEATURES: ResponseFeature[] = [
  {
    id: "resp.low_freq",
    label: "Low-frequency behaviour",
    description: "The roll-off region below the flat band.",
  },
  {
    id: "resp.midband",
    label: "Mid-band sensitivity",
    description: "The flat region around the 1 kHz sensitivity reference.",
  },
  {
    id: "resp.high_freq",
    label: "High-frequency behaviour",
    description: "The region where the response departs from flat towards the peak and beyond.",
  },
  {
    id: "resp.resonance_peak",
    label: "Resonance / peak",
    description: "A localised rise in sensitivity caused by an underdamped resonance.",
  },
];
