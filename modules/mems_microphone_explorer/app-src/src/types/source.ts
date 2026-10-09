export type SourceType =
  | "manufacturer_datasheet"
  | "application_note"
  | "academic_paper"
  | "textbook"
  | "technical_reference"
  | "derived_model";

export interface Source {
  id: string;
  title: string;
  sourceType: SourceType;

  publisher?: string;
  authors?: string[];

  url?: string;

  documentId?: string;
  revision?: string;
  publicationDate?: string;

  page?: number;
  section?: string;
  figure?: string;
  table?: string;

  doi?: string;

  notes?: string;
}
