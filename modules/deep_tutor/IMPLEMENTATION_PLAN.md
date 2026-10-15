# DeepTutor plugin: implementation plan

## Problem: questions whose answer sits in a PDF table

Upstream's built-in (`text_only`) PDF extraction writes a table as one cell per line. In the index, Table 1 of
IEC 60118-13 became "all 11 column headers, then 3 rows of values". `gemma4:e4b` and `qwen3:8b` then have to count
columns across runs of repeated "Not relevant" cells and often attach a value to the wrong column. Retrieval is not
the problem (the whole table is one chunk); the lost row/column structure is.
Knowledge-base settings at the time: `image_description_model: null`, OCR off, chunk 512/50, `nomic-embed-text`.

## Option 1: structure tables at index time (DONE)

- `inject/py/one_ead_tables.py`: finds ruled tables with PyMuPDF `find_tables()` (pages with fewer than 6 vector
  drawings are skipped), fills merged cells, splits footnote-only columns off as notes, picks the header row (first or
  last row, whichever holds no numeric/"Not relevant" cells; PDFs with rotated pages come out bottom-up) and writes the
  table back as plain sentences: the caption, one line saying what the table lists, then one sentence per row
  (`Table 1, User compatibility IRIL <= 55 dB SPL for field strengths, E V/m, Frequency range in GHz 1,4 to 2,0:
  Microphone mode, Induction pick-up coil a mode = 40; Directional a mode = Not relevant.`). Columns with equal values
  are merged and rows that are all "Not relevant" are collapsed into one line. Tables without a recognisable header
  fall back to a Markdown grid. The flattened cell lines are removed from the page text (a cluster of lines made only
  of table words, covering at least 60% of the cells); if no cluster is found the block is appended instead.
  Sentences were chosen over `key = value` lists and Markdown grids after measuring how close each embeds to
  natural-language questions.
- `inject/py/sitecustomize.py`: wraps `TextOnlyParser.parse` (runs the pass in upstream's isolated worker, 900 s limit,
  failure keeps plain text) and `signature` (`+tablesN`, N = `one_ead_tables.VERSION`, so existing parses are not
  reused). Loaded through `PYTHONPATH` set in `_serve.py` for the backend process only; the uvicorn command line is
  untouched on purpose (upstream's orphan detection matches `-m uvicorn deeptutor.api.main:app`). Bump `VERSION` after
  any change to the output format.
- Checked on `EN IEC_60118-13_2020.pdf`: Table 1 now reads correctly (user compatibility, 1,4 to 2,0 GHz,
  microphone mode = 40 V/m; bystander 1,4 to 2,7 GHz = 10 V/m); only genuine tables changed on other pages. A
  625-page textbook took about 100 s and found 19 tables.
- To apply to an existing knowledge base: restart the service, then **Re-index** the knowledge base in the Knowledge
  Center (re-parses and re-embeds with Ollama). Changing the embedding signature (see "Retrieval" below) makes
  every existing index need this once.

Known limits: only ruled tables; borderless tables stay flattened; chat attachments and non-PDF formats are not
processed; row groups are only filled down in the first column; a table whose header cannot be told from its data gets
generic `col N` headers and no sentences.

### Possible refinements of option 1

- Add a `find_tables(strategy="text")` fallback for borderless tables, behind a confidence check on the grid.
- Fill merged cells in every leading label column, not only the first.
- Apply the same pass to chat attachments (`extract_text_from_path`) and to DOCX/XLSX tables.
- Keep a per-table JSON sidecar so the Sources panel can show the table cell that was retrieved.
- Regression test: a few real PDFs under `modules/deep_tutor/tests/` with expected Row facts.

## Retrieval: why the structured table was still not found (2026-10-13)

After option 1 the chat still answered "no numerical V/m level" for "what is the V/m test level is being used and the
test frequency coverage for IRI". The table was indexed correctly; search simply did not return it. Measured with
DeepTutor's own `RAGService.search` on the Acoustic Standard knowledge base (210 chunks):

- Search is hybrid (vector + BM25, reciprocal-rank fusion, `top_k` 5, no reranker). A chunk found by only one of the
  two lists scores about half of a chunk found by both, so a table that matches the question semantically but not
  lexically loses.
- `nomic-embed-text` needs task prefixes (`search_document: ` / `search_query: `); upstream sends plain text to Ollama
  (its own docs: "OpenAI/Ollama: Ignored"). Plain: the table chunk ranked 47th by vector similarity. With prefixes: 3rd.
- The question says "IRI" while the standard says "IRIL", so BM25 gets nothing from that word; with "IRIL" the table
  comes 5th-6th.

Done (all in `inject/py/sitecustomize.py` unless noted):

- Ollama adapter patched to send the nomic prefixes (sets `SUPPORTS_INPUT_TYPE`, otherwise the client drops the role)
  and the embedding signature gets `role_semantics = "nomic-task-prefix"`. Old indexes then need a **Re-index**; both
  knowledge bases were rebuilt on 2026-10-13. To force a rebuild through the API when the signature did not change:
  `POST /api/knowledge-bases/<kb>/reindex` with form field `embedding_model={"profile_id":...,"model_id":...}`.
- `top_k` raised from 5 to 8 in `data/home/data/user/settings/llamaindex.json` (about 5.5k tokens of context at 8192).
- Table block carries a line with the words people use ("values, test levels, limits and requirements").

Tried and not adopted:

- LLM-written table summaries (`qwen3:8b`, `gemma4:e4b`, 25-40 s per table): moved the table from rank 17 to 7-8 only.
- `embeddinggemma` as the embedder: Ollama returned HTTP 500 for it in the first test; not investigated further.

Still open, in order of expected value:

1. Cross-encoder reranker (`reranker_model` in `llamaindex.json`; needs `sentence-transformers` + a model download such
   as `BAAI/bge-reranker-base`, CPU or GPU). It scores query and chunk together, so it ignores the vector/BM25 split.
2. Query rewriting before retrieval (fix typos, add synonyms), either by the chat model or a small `qwen3:4b` call.
3. Give the chunk that cites a table ("... test levels defined in Table 1 ...") the table's sentences as well, so
   questions that match the citing text still pull in the numbers.
4. Evaluate `mxbai-embed-large` or a re-tested `embeddinggemma` against `nomic-embed-text` on a handful of real
   questions (build a small question set first; `RAGService.search` can be scripted as in the checks above).
5. Tune `vector_top_k_multiplier` / `bm25_top_k_multiplier` or switch to a vector-weighted fusion.

## Option 2: use a table-aware parsing engine (not done)

Upstream already offers engines in Settings > Document Parsing: `pymupdf4llm`, `docling`, `mineru`, `markitdown`,
`liteparse`, `tika` (one-click pip install for the first four).

- Tried `pymupdf4llm` 1.28.2 (pulls `pymupdf_layout`, `onnxruntime`, `protobuf`; since uninstalled again) on page 18 of
  the IEC standard: it did recover a grid but garbled the merged header cells ("gths,", "atibility") and kept the
  rotated orientation, so it was judged worse than option 1.
- `docling` and `mineru` use layout/table-structure models (heavier: model downloads, ideally a GPU; the machine has a
  6 GB GTX 1660 Ti that is already shared with Ollama). Worth trying on one document and comparing against option 1
  before adopting; they would also give OCR for scanned standards.
- If adopted, keep option 1 as the fallback for engines that return flattened text, and check that the `--- Page N ---`
  markers still exist because the chat Sources panel depends on them.

## Option 3: describe table images with a vision model (not done)

- Render each table region to an image and ask a vision-capable local model (`gemma4:e4b` may support images; verify
  with Ollama first) to transcribe it to Markdown, then index that text. Slow on this GPU and the model can still
  misread numbers, so use it only for scanned or borderless tables that options 1 and 2 miss.
- Upstream's `image_description_model` setting is the existing hook for captioning images in the index; check whether it
  can be pointed at a table crop before building anything custom.
- Do not let the model rewrite numbers silently: store the Markdown beside the source page so the Sources panel can
  link to the original.

## Option 4: prompting workarounds (not done, cheapest)

- Ask for the table row by row ("list every value in the Microphone mode row with its frequency range") or ask the
  model to quote the Row facts line it used.
- Use `qwen3:8b` with thinking on for table questions.
- Add a short note to the chat system prompt telling the model to prefer `Row facts:` lines over the grid when both are
  present.

## Other follow-ups

- Chat answers: add the retrieved table row to the Sources panel excerpt (the excerpt is truncated at 300 characters,
  which cuts Row facts lines).
- Evaluate retrieval for numeric questions: BM25 plus `nomic-embed-text` may rank the caption chunk over the table
  chunk; consider a larger `chunk_size` for table-heavy standards.
