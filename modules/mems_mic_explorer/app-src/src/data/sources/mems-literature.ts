import type { Source } from "../../types/source";

// Generic MEMS / acoustics literature. Citations are at book / paper level; pin-point
// pages and sections have NOT been verified yet, so no page numbers are stated.
const unverifiedLocation = "Citation is at document level; pin-point page/section not yet verified.";

export const BERANEK_MELLOW: Source = {
  id: "beranek-mellow-2012",
  title: "Acoustics: Sound Fields and Transducers",
  sourceType: "textbook",
  authors: ["Leo L. Beranek", "Tim J. Mellow"],
  publisher: "Academic Press (Elsevier)",
  publicationDate: "2012",
  notes: `Lumped-element acoustic and electroacoustic analogies, compliance/inertance/resistance, condenser transducers. ${unverifiedLocation}`,
};

export const KINSLER: Source = {
  id: "kinsler-2000",
  title: "Fundamentals of Acoustics, 4th ed.",
  sourceType: "textbook",
  authors: ["Lawrence E. Kinsler", "Austin R. Frey", "Alan B. Coppens", "James V. Sanders"],
  publisher: "John Wiley & Sons",
  publicationDate: "2000",
  notes: `Resonators, acoustic impedance, lumped acoustic elements. ${unverifiedLocation}`,
};

export const SCHEEPER: Source = {
  id: "scheeper-1994",
  title: "A review of silicon microphones",
  sourceType: "academic_paper",
  authors: ["P. R. Scheeper", "A. G. H. van der Donk", "W. Olthuis", "P. Bergveld"],
  publisher: "Sensors and Actuators A: Physical, vol. 44",
  publicationDate: "1994",
  notes: `Capacitive silicon microphone principles (diaphragm, backplate, air gap, damping). DOI not recorded. ${unverifiedLocation}`,
};

export const TIMOSHENKO: Source = {
  id: "timoshenko-1959",
  title: "Theory of Plates and Shells, 2nd ed.",
  sourceType: "textbook",
  authors: ["Stephen P. Timoshenko", "S. Woinowsky-Krieger"],
  publisher: "McGraw-Hill",
  publicationDate: "1959",
  notes: `Classical plate/membrane stiffness theory (clamped circular plate). ${unverifiedLocation}`,
};

export const STANDARD_PHYSICS: Source = {
  id: "standard-physics",
  title: "Standard textbook physics (elementary mechanics, electrostatics, acoustics)",
  sourceType: "technical_reference",
  notes:
    "Used only for textbook-standard relations (e.g. parallel-plate capacitance, mass-spring resonance, Hooke's law) that are derived directly from first principles. Not a pin-point citation.",
};

/** The simplified models authored for this application. */
export const APP_CONCEPTUAL_MODEL: Source = {
  id: "app-conceptual-model",
  title: "MEMS Microphone Acoustic Explorer — conceptual / educational model definitions",
  sourceType: "derived_model",
  publisher: "This application",
  notes:
    "Illustrative geometry, illustrative lumped values and simplified frequency-response models authored for teaching. NOT manufacturer data and NOT validated against the MM20.",
};

export const MEMS_LITERATURE_SOURCES: Source[] = [
  BERANEK_MELLOW,
  KINSLER,
  SCHEEPER,
  TIMOSHENKO,
  STANDARD_PHYSICS,
  APP_CONCEPTUAL_MODEL,
];
