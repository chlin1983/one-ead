import type { Source } from "../../types/source";

const MM20_URL =
  "https://www.knowles.com/docs/default-source/default-document-library/mm20-33366-b116.pdf?Status=Master&sfvrsn=c6b071b1_0";

const base: Omit<Source, "id" | "title"> = {
  sourceType: "manufacturer_datasheet",
  publisher: "Knowles Electronics, LLC",
  url: MM20_URL,
  documentId: "MM20-33366-B116",
  revision: "A (11/26/2018)",
  publicationDate: "2019-01-23",
};

/** Document-level record. */
export const MM20_DATASHEET: Source = {
  ...base,
  id: "knowles-mm20-datasheet",
  title: "Knowles MM20-33366-B116 MEMS Microphone Datasheet",
  notes: "Official manufacturer datasheet, 10 sheets. Location-specific records below point at individual sheets/tables/figures.",
};

export const MM20_FEATURES: Source = {
  ...base,
  id: "knowles-mm20-features",
  title: "Knowles MM20-33366-B116 — product description & features",
  page: 1,
  section: "Product description / Product Features",
};

export const MM20_TABLE1: Source = {
  ...base,
  id: "knowles-mm20-table1",
  title: "Knowles MM20-33366-B116 — Table 1: General Microphone Specifications",
  page: 2,
  section: "Acoustic & Electrical Specifications",
  table: "Table 1",
  notes: "Test conditions: 22 ± 2 °C, 50 ± 5 % R.H., VDD = 0.9 V, no load, unless otherwise indicated.",
};

export const MM20_FIG1: Source = {
  ...base,
  id: "knowles-mm20-fig1",
  title: "Knowles MM20-33366-B116 — Figure 1: Typical frequency response",
  page: 3,
  section: "Frequency Response",
  figure: "Figure 1",
  notes:
    "Typical response measured in a pressure cavity under nominal conditions (Table 1). Response above 10 kHz is typical in free field and not measured in the pressure cavity.",
};

export const MM20_MECH: Source = {
  ...base,
  id: "knowles-mm20-mech",
  title: "Knowles MM20-33366-B116 — Mechanical Specifications",
  page: 4,
  section: "Mechanical Specifications",
  notes: "Dimensions in millimetres, drawing is labelled with the port type '12JPn Port'. Weight 0.023 g.",
};

export const KNOWLES_MM20_SOURCES: Source[] = [MM20_DATASHEET, MM20_FEATURES, MM20_TABLE1, MM20_FIG1, MM20_MECH];
