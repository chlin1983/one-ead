# GPT Researcher

Offline-first engineering research assistant for One EAD. It wraps
[gpt-researcher](https://github.com/assafelovic/gpt-researcher) (Apache-2.0) and drives it with a local
[Ollama](https://ollama.com) model (e.g. `gemma4:e4b`, `qwen3:8b`). No Docker, no cloud LLM.

## Using it

1. Open **GPT Researcher** in One EAD. If shown, click **Install engine** (one-time, needs internet).
2. Make sure Ollama is running and a chat model is installed (the page offers to download one).
3. Optional: add your own PDF / Word / text / Markdown / CSV / Excel / PowerPoint files under **My documents**
   (tick the ones to use for a run).
4. Write the question, choose **Sources** and **Report type**, press **Start research**.
5. Finished reports stay under **Reports** (they survive restarts of One EAD). Open one to read it, copy it, or
   download it as **Markdown** or **PDF**. The page reopens your last report and keeps your question draft.
   The question form is only shown for a new or running research: opening a report hides it (and the live log,
   leaving a small "running" banner with Show progress / Cancel). **+ New research** (above the report list) brings
   the empty form back; **Reuse as new** in an open report copies its question and settings into the form.

### Report types

| Type | What it does | Typical time (6 GB GPU, qwen3:8b) |
| --- | --- | --- |
| **Detailed technical report (sections)** - default | Researches with 4 sub-queries, then writes the report section by section (outline, one call per section with only the best-matching evidence, introduction, conclusions, numbered references). Keeps 2000-3000 words technical and sourced even with an 8k-token model context. | 15-25 min for 2500 words |
| Quick research report (single pass) | gpt-researcher's own one-call report. Best below about 1500 words. | 3-5 min |
| Outline / Resource list | Structure or annotated source list only. | 2-4 min |
| Deep research (slow) | gpt-researcher's recursive deep research (small breadth and depth for local models). | 15+ min |

**Target length** defaults to **2500 words** (300-3000). It is a target: the model may land 20-50 % above or below.
Section-by-section writing lowers that risk but cannot add facts that the sources do not contain.

### Organising reports

- **Rename:** hover a report and click the pencil, double-click its title, or use **Rename** in the open report. The
  question stays visible under the new name; clearing the name restores the question.
- **Folders:** **+ Folder** creates one (type its name right away). Drag a report onto a folder to file it, or onto
  **Not in a folder** to take it out. Rename a folder with the pencil or a double-click; click it to collapse or expand.
  Deleting a folder (x) never deletes reports; they just become unfiled.
- **Panel width:** drag the right edge of the left panel (double-click resets, or focus it and use the arrow keys). The
  width and the open/closed folders are remembered in the browser.
- Names and folder assignments are stored server-side (`meta.json` per report, `data/folders.json`), so they survive
  restarts and show in any browser.

### Reading a report

- **References** are numbered 1, 2, 3... in order of first citation (the engine's internal source numbers are
  renumbered when a report is opened; the untouched text stays in `report.orig.md`), one per line.
- Every URL is a clickable link (new tab). A citation such as `[3]` or `[3, 5]` in the text is clickable too: it scrolls
  to that reference and highlights it.
- The text column is limited to 70 % of the viewer width (`.md` in `web/app.css`).

### PDF export

**Download PDF** renders the report on demand with PyMuPDF inside the private environment (A4, headings, tables,
lists, Greek letters and engineering symbols, page footer with model and date). URLs are clickable hyperlinks in the
PDF and each reference is on its own line. Raw HTML in a report is escaped and
nothing is fetched while rendering. The PDF is cached next to the Markdown (`report.pdf`) and re-rendered when the
report or the exporter changes.

## Privacy model

| Layer | What is enforced |
| --- | --- |
| LLM | Local Ollama on `127.0.0.1:11434` only. The runner refuses to start if the URL is not loopback. |
| Keys | Each job gets a **whitelisted environment**: your OpenAI / Tavily / LangSmith / ... variables are never inherited. |
| Network, offline mode (**My documents only**) | `_run_research.py` installs a Python-level guard that refuses every non-loopback connection and DNS lookup. Verified: the engine's own web retriever is blocked in this mode. |
| Network, web modes (opt-in) | Cloud AI and telemetry hosts stay blocked (also by URL, so a corporate proxy cannot hide them). Only the search terms written by the local model and page downloads leave the PC; the sites see your IP. Documents and the model never do. |
| Context filter | `CONTEXT_FILTER=keyword` (local BM25). The default cloud filter (TypeSafe Jev) is never used. Tavily is not used. |
| Isolation | Private venv in `data/venv` (Python 3.12+, `gpt-researcher` and `ddgs==9.16.0` pinned; baseline 0.16.1), fake user profile in `data/home`, no extra server port. Engine updates only happen after verification (see "Updating the engine"). |

Limits to be aware of: the guard is in-process (a Python-level control, not a firewall) and loopback connections stay
allowed. For a hard guarantee in offline use, also block `data/venv/Scripts/python.exe` outbound in Windows Firewall.
On a company network, IT can still see which hosts you contact (and the query text if HTTPS is inspected).
Keep project names, part numbers and customer names out of web questions; use offline mode for confidential work.

## Web sources: limits and terms

Only tick sources whose terms you are comfortable with. Defaults are the four academic ones; DuckDuckGo is off.
Requests to the academic APIs are sent **one at a time per host** with the minimum spacing below, and a 429/503
reply makes the job wait 10x longer before the next request to that host.

| Source | What is used | Rate limit applied | Terms / notes |
| --- | --- | --- | --- |
| arXiv | Official API (`export.arxiv.org`) for search; PDFs from `arxiv.org/pdf` | API: 1 request / 3 s, one connection at a time (arXiv's rule). PDFs: arXiv's robots.txt `Crawl-delay: 15` is obeyed. | API terms allow retrieving content for personal or research use; no redistribution. "Indiscriminate automated downloads" are not permitted, so keep runs small. |
| Semantic Scholar | Official API; only open-access PDF links it lists | 1 request / 5 s | Free unauthenticated pool is shared and often answers 429; results may be missing. |
| OpenAlex | Official API (metadata CC0); open-access PDF or landing page | 1 request / s | Free. No email or key is sent (privacy); that means the shared, less predictable pool. |
| PubMed Central | NCBI E-utilities (`efetch` full text, no page scraping) | 1 request / s (NCBI allows 3/s without a key) | E-utilities are an approved automated route. Article licences vary; only some are open access. Do not use for bulk retrieval. |
| DuckDuckGo (general web) | `ddgs` package scrapes search pages unofficially | none beyond the scraper delay | Not an official API and against typical search-engine terms; then every result page is scraped. Off by default. |

Page downloads (the pages and PDFs that the search results point to) are polite too:

- the scraper identifies itself truthfully (`OneEAD-GPT-Researcher/1.0`) instead of pretending to be a browser,
- **robots.txt is honoured**: disallowed pages are skipped and any `Crawl-delay` (max 30 s) is waited out,
- pages are fetched at most one every 2 s with 4 workers,
- TLS certificate checks cannot be disabled (the engine would otherwise retry some PDFs without verification).
  Behind a TLS-inspecting proxy set `SSL_CERT_FILE` to your company CA bundle before starting One EAD.

Many publisher sites (Springer, ScienceDirect, MDPI, ...) disallow robots, so closed or restricted full texts are
skipped; paywalled papers should be added as PDFs under **My documents** instead. This is not legal advice: check
your company policy for automated access to third-party sites.

## Quality notes

- Output quality depends on the local model and on how relevant the retrieved sources are. Narrow engineering
  topics often return loosely related papers; read the numbered references and check every number in the source.
- Some models (notably gemma) write formulas as LaTeX (`$5.3 \times 3.1 \text{ mm}$`). The viewer has no math
  renderer, so reports are converted to plain Unicode text (`5.3 × 3.1 mm`) when first opened or downloaded; the
  untouched original is kept as `report.orig.md`. The model is also told not to use LaTeX.
- Ollama needs a context window large enough for the prompts. The default is 8192 tokens (suits a 6 GB GPU);
  higher values may spill to the CPU and slow down (Advanced).
- A run stops after 2 hours. A run in progress is cancelled if One EAD stops, and shows as "interrupted".

## Files

- `researcher.py`: manager (install, engine updates, Ollama, document library, jobs, reports, PDF export).
- `_run_research.py`: runs one job in the private venv; network guard, HTTP policy and the sectioned writer live here.
- `_compat.py`: engine compatibility checks (every job start, and when vetting an update).
- `_export_pdf.py`: renders a report to PDF in the private venv.
- `module.py`: API router at `/api/gpt-researcher`.
- `web/`: UI. Data (`data/`: venv, documents, reports) is git-ignored.

## Updating the engine

The plugin looks up the newest `gpt-researcher` release on PyPI every 6 hours (one GET to pypi.org, nothing sent about
you) and shows `engine v0.16.1 ↑ X` in the header; click the chip for the engine panel. Note that PyPI lags behind
GitHub `main`: only published releases are offered.

**Update & verify** never touches the working engine until the new one has passed everything:

1. installs the release into a separate `data/venv-next`,
2. `_compat.py` checks that every engine API, config key and retriever this plugin relies on still exists and is applied,
3. runs a tiny offline test job (fictional datasheet, smallest recommended installed model) through the real runner,
4. swaps it in (old engine kept as `data/venv-prev`) and confirms it starts; otherwise the old one is restored.

Any failed check discards the new copy and records the version as failed. **Roll back** swaps `venv-prev` back at any
time (and swapping again returns). Every research job also runs `_compat.py` first, so an incompatible engine fails
with a clear message instead of misbehaving. Verified versions are stored in `data/engine.json`.

**Install verified updates automatically** (off by default) applies the same pipeline unattended, but only for the same
major version, releases older than 48 h, versions that have not failed before, and only when Ollama can run the test job.
Tunables near the top of `researcher.py`: `SCRAPER_DELAY_S`, `USER_AGENT`, `DEFAULT_WORDS`, `CHECK_EVERY_S`,
`AUTO_MIN_AGE_H`; per-host API spacing is `API_INTERVALS` in `_run_research.py`.
