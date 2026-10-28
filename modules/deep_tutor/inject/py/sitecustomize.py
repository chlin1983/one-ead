"""One EAD: loaded in DeepTutor's Python processes through PYTHONPATH (see _serve.py).

Two retrieval fixes applied without editing upstream files, so they keep working across upstream updates
(if an upstream internal changes, the hook is skipped and stock behaviour remains):

* table-aware text for the built-in PDF extractor (one_ead_tables.py);
* nomic-embed-text task prefixes ("search_document: " / "search_query: "), which upstream does not send to
  Ollama. nomic's model card requires them; without them questions rank table and spec chunks far too low.
"""

import dataclasses
import importlib.abc
import importlib.machinery
import re
import sys
from pathlib import Path

_NOMIC_PREFIX = {"search_document": "search_document: ", "search_query": "search_query: "}
_STRAY_VAR_RE = re.compile(r"(?<!\$)\$\s*(?:\\text\{)?([A-Za-z0-9_.-]+)\}?\s*\$(?!\$)")


def _clean_stray_math(text: str) -> str:
    if not text or "$" not in text:
        return text
    # Clean latex text commands like \, \text{dB} -> dB
    text = re.sub(r"\\,\s*\\text\{([^{}]+)\}", r" \1", text)
    text = re.sub(r"\\text\{([^{}]+)\}", r"\1", text)
    # Strip inline $ ... $ (non-newline)
    text = re.sub(r"(?<!\$)\$(?!\$)\s*([^\n$]+?)\s*(?<!\$)\$(?!\$)", r"\1", text)
    # If any single $ remain before or after words, strip them
    text = re.sub(r"(?<!\$)\$(?!\$)", "", text)
    return text


def _normalize_scrambled_formulas(text: str) -> str:
    if not text:
        return text
    text = text.replace("\u2212", "-")
    # ETLS vertical stream-order artifact: ETLS \n (RTG + 60) \n V \n = \n -
    text = re.sub(
        r"ETLS\s*\n\s*\(RTG\s*\+\s*60\)\s*\n\s*V\s*\n\s*=\s*\n\s*-",
        "ETLS = V - (RTG + 60)",
        text,
    )
    # RSETS vertical stream-order artifact: RSETS \n (RTG + 60) \n T \n = \n -
    text = re.sub(
        r"RSETS\s*\n\s*\(RTG\s*\+\s*60\)\s*\n\s*T\s*\n\s*=\s*\n\s*-",
        "RSETS = T - (RTG + 60)",
        text,
    )
    # EEIS vertical stream-order artifact: EEIS \n RTG + 60 \n E \n = \n -
    text = re.sub(
        r"(?:\(\s*\n\s*\)\s*\n\s*)?EEIS\s*\n\s*RTG\s*\+\s*60\s*\n\s*E\s*\n\s*=\s*\n\s*-",
        "EEIS = E - (RTG + 60)",
        text,
    )
    # EWLS vertical stream-order artifact: EWLS \n RTG \n 60 \n W \n = \n - \n +
    text = re.sub(
        r"(?:\(\s*\n\s*\)\s*\n\s*)?EWLS\s*\n\s*RTG\s*\n\s*60\s*\n\s*W\s*\n\s*=\s*\n\s*-\s*\n\s*\+",
        "EWLS = W - (RTG + 60)",
        text,
    )
    return text


def _version() -> str:
    import one_ead_tables

    return one_ead_tables.VERSION


def _patch_text_parser(module) -> None:
    cls = getattr(module, "TextOnlyParser", None)
    if cls is None or getattr(cls, "_one_ead_tables", False):
        return
    original_parse, original_signature = cls.parse, cls.signature

    def signature(self, config):
        sig = original_signature(self, config)
        # A new version string makes DeepTutor re-parse documents instead of reusing plain-text parses.
        return type(sig).build(sig.engine, f"{sig.engine_version}+tables{_version()}", dict(sig.params))

    def parse(self, source_path, workdir, *, config, on_output=None):
        original_parse(self, source_path, workdir, config=config, on_output=on_output)
        if Path(source_path).suffix.lower() != ".pdf":
            return
        markdown = Path(workdir) / f"{Path(source_path).stem}.md"
        try:
            from deeptutor.runtime.isolated_worker import run_in_isolated_process_sync

            if on_output:
                on_output("Structuring tables...")
            run_in_isolated_process_sync(
                "one_ead_tables:restructure_file", str(source_path), str(markdown), timeout=900.0
            )
        except Exception as exc:  # the plain text is still valid
            print(f"[one-ead] table structuring skipped for {Path(source_path).name}: {exc}", flush=True)

    cls.signature, cls.parse, cls._one_ead_tables = signature, parse, True


def _is_nomic(model) -> bool:
    return str(model or "").strip().lower().startswith("nomic-embed-text")


def _patch_ollama_adapter(module) -> None:
    cls = getattr(module, "OllamaEmbeddingAdapter", None)
    if cls is None or getattr(cls, "_one_ead_prefix", False):
        return
    original = cls.embed

    async def embed(self, request):
        prefix = _NOMIC_PREFIX.get(request.input_type)
        if prefix and not request.contents and _is_nomic(request.model or self.model):
            request = dataclasses.replace(request, texts=[prefix + t for t in request.texts])
        return await original(self, request)

    cls.embed, cls._one_ead_prefix = embed, True
    cls.SUPPORTS_INPUT_TYPE = True  # otherwise the client drops the query/document role before it reaches the adapter


def _patch_signature(module) -> None:
    original = getattr(module, "signature_from_config", None)
    if original is None or getattr(original, "_one_ead_prefix", False):
        return

    def signature_from_config(config):
        sig = original(config)
        # Prefixed vectors live in a different vector space, so such indexes must not match older ones.
        if sig.binding == "ollama" and _is_nomic(sig.model) and not sig.role_semantics:
            sig = dataclasses.replace(sig, role_semantics="nomic-task-prefix")
        return sig

    signature_from_config._one_ead_prefix = True
    module.signature_from_config = signature_from_config


def _patch_agent_pipeline(module) -> None:
    setattr(module, "KB_SEED_CHARS_PER_KB", 18000)
    cls = getattr(module, "AgenticLoopPipeline", None)
    if cls and not getattr(cls, "_one_ead_patched_init", False):
        orig_init = cls.__init__

        def __init__(self, *args, **kwargs):
            orig_init(self, *args, **kwargs)
            m_lower = str(getattr(self, "model", "")).lower()
            if getattr(self, "binding", None) == "ollama" or "qwen" in m_lower or "gemma" in m_lower or "llama" in m_lower:
                self.reasoning_effort = "none"
                if hasattr(self, "_client_config") and self._client_config:
                    import dataclasses
                    try:
                        self._client_config = dataclasses.replace(self._client_config, reasoning_effort="none")
                    except Exception:
                        pass
            self._exploring_max_tokens = max(getattr(self, "_exploring_max_tokens", 1600), 4096)

        orig_build = getattr(cls, "_build_loop_messages", None)
        if orig_build:
            def _clean_history_user_msg(msg):
                if not isinstance(msg, dict) or msg.get("role") != "user":
                    return msg
                content = msg.get("content")
                if isinstance(content, str) and "[Knowledge Base Context]" in content:
                    clean = content.split("\n\n[Knowledge Base Context]")[0].strip()
                    if clean:
                        new_msg = dict(msg)
                        new_msg["content"] = clean
                        return new_msg
                return msg

            def _build_loop_messages(self, *args, **kwargs):
                msgs = orig_build(self, *args, **kwargs)
                # Keep system prompt (msgs[0]) and current turn's prompt (msgs[-1]).
                # Strip old bulky KB dumps from intermediate history turns to prevent 24k token bloat and timeouts.
                if len(msgs) > 2:
                    pruned = [msgs[0]]
                    for m in msgs[1:-1]:
                        pruned.append(_clean_history_user_msg(m))
                    pruned.append(msgs[-1])
                    return pruned
                return msgs

            cls._build_loop_messages = _build_loop_messages

        orig_run = getattr(cls, "run", None)
        if orig_run and not getattr(cls, "_one_ead_patched_run", False):
            async def run(self, *args, **kwargs):
                res = await orig_run(self, *args, **kwargs)
                if isinstance(res, dict):
                    for k in ("text", "content", "answer"):
                        if isinstance(res.get(k), str):
                            res[k] = _clean_stray_math(res[k])
                return res

            cls.run = run
            cls._one_ead_patched_run = True

        cls.__init__ = __init__
        cls._one_ead_patched_init = True


def _patch_chat_pipeline(module) -> None:
    setattr(module, "KB_SEED_CHARS_PER_KB", 18000)


def _patch_reranker(module) -> None:
    original = getattr(module, "rerank_nodes", None)
    if original is None or getattr(original, "_one_ead_diverse", False):
        return

    def rerank_nodes(query, nodes, *, top_k, model_name, loader=None):
        if not nodes:
            return []
        candidates = nodes[: min(len(nodes), 25)]
        ranked_nodes = original(query, candidates, top_k=len(candidates), model_name=model_name, loader=loader)
        if not ranked_nodes or top_k <= 0:
            return ranked_nodes[: max(1, int(top_k))]

        # Group candidates by source document
        doc_buckets: dict[str, list] = {}
        for nws in ranked_nodes:
            doc_buckets.setdefault(_doc_name(nws.node) or "default", []).append(nws)

        # Within each document, order chunks by lexical overlap with the query terms (generic, no domain
        # keywords); the reranker order is kept as the tie-breaker.
        terms = _query_terms(query)
        if terms:
            for b_nodes in doc_buckets.values():
                order = {id(n): i for i, n in enumerate(b_nodes)}
                b_nodes.sort(key=lambda n: (-_term_overlap(n.node.get_content(), terms), order[id(n)]))

        # Documents named after an item in the query (part number, model, standard id) go first.
        entities = _query_entities(query)
        doc_ids = list(doc_buckets)
        if entities:
            doc_ids.sort(key=lambda d: 0 if any(_entity_in(e, d) for e in entities) else 1)

        # Round-robin so every document contributes its best chunk before any document gets a second one.
        selected, picked = [], set()
        max_depth = max(len(v) for v in doc_buckets.values())
        for depth in range(max_depth):
            for doc_id in doc_ids:
                b_nodes = doc_buckets[doc_id]
                if depth < len(b_nodes) and len(selected) < top_k:
                    selected.append(b_nodes[depth])
                    picked.add(id(b_nodes[depth]))
            if len(selected) >= top_k:
                break

        return selected[:top_k]

    rerank_nodes._one_ead_diverse = True
    module.rerank_nodes = rerank_nodes


def _patch_retrievers(module) -> None:
    # Patch QueryFusionRetriever so Vector and BM25 merge by node_id instead of node.hash
    # (node.hash differs between vector nodes and BM25 nodes for the exact same document chunk)
    try:
        from llama_index.core.retrievers.fusion_retriever import QueryFusionRetriever

        if not getattr(QueryFusionRetriever, "_one_ead_nid_patched", False):
            orig_rrf = QueryFusionRetriever._reciprocal_rerank_fusion

            def _reciprocal_rerank_fusion_patched(self, results):
                k = 60.0
                fused_scores = {}
                id_to_node = {}
                for nodes_with_scores in results.values():
                    for rank, nws in enumerate(sorted(nodes_with_scores, key=lambda x: x.score or 0.0, reverse=True)):
                        nid = getattr(nws.node, "node_id", None) or getattr(nws.node, "id_", None) or nws.node.hash
                        id_to_node[nid] = nws
                        if nid not in fused_scores:
                            fused_scores[nid] = 0.0
                        fused_scores[nid] += 1.0 / (rank + k)
                reranked_results = dict(sorted(fused_scores.items(), key=lambda x: x[1], reverse=True))
                reranked_nodes = []
                for nid, score in reranked_results.items():
                    nws = id_to_node[nid]
                    nws.score = score
                    reranked_nodes.append(nws)
                return reranked_nodes

            QueryFusionRetriever._reciprocal_rerank_fusion = _reciprocal_rerank_fusion_patched
            QueryFusionRetriever._one_ead_nid_patched = True
    except Exception as exc:
        print(f"[one-ead] QueryFusionRetriever patch skipped: {exc}", flush=True)

    original = getattr(module, "retrieve_nodes", None)
    if original is None or getattr(original, "_one_ead_multi", False):
        return

    def retrieve_nodes(index, storage_dir, query, *, top_k=5):
        entities = _query_entities(query)
        if len(entities) >= 2:
            # Multi-item question (compare / summarize several parts, models, standards):
            # Guarantee coverage for EVERY item by picking its single best-matching chunk
            # from the docstore (highest lexical overlap with the query's property terms).
            terms = _query_terms(query)
            seen, combined = set(), []

            def _add(nws):
                nid = getattr(nws.node, "node_id", None) or getattr(nws.node, "id_", None) or str(hash(nws.node.get_content()[:200]))
                if nid not in seen:
                    seen.add(nid)
                    combined.append(nws)

            try:
                from llama_index.core.schema import NodeWithScore

                all_nodes = list(index.docstore.docs.values())
                for e in entities:
                    owned = [n for n in all_nodes if _entity_in(e, _doc_name(n))]
                    if not owned:  # item not in file name: fall back to documents mentioning it
                        owned = [n for n in all_nodes if _entity_in(e, getattr(n, "text", "") or "")]
                    if owned:
                        owned.sort(key=lambda n: -_term_overlap(n.get_content(), terms))
                        # Pick the single best chunk for this entity so all items fit cleanly in context
                        _add(NodeWithScore(node=owned[0], score=1.0))
            except Exception as exc:
                print(f"[one-ead] per-item docstore pick skipped: {exc}", flush=True)

            # If any entities had no matching chunks in docstore, fall back to hybrid search up to len(entities)
            if len(combined) < len(entities):
                for bn in original(index, storage_dir, query, top_k=len(entities)):
                    _add(bn)
                    if len(combined) >= len(entities):
                        break

            return combined[: len(entities)]

        # Single-topic or general question (e.g., standard definitions, formulas, procedures):
        # Fetch candidate nodes, filter out pure Table of Contents (dot leaders), and score
        # by query terms and explicit formula/definition indicators so the governing clause ranks first.
        candidate_k = max(int(top_k) * 3, 15)
        raw_candidates = original(index, storage_dir, query, top_k=candidate_k)
        if not raw_candidates:
            return []

        def _is_toc(text: str) -> bool:
            return len(re.findall(r"\.{4,}", text or "")) >= 3

        terms = _query_terms(query)

        def _relevance_score(nws) -> float:
            text = getattr(nws.node, "text", "") or nws.node.get_content()
            if _is_toc(text):
                return -999.0
            score = float(_term_overlap(text, terms))
            t_low = text.lower()
            for term in terms:
                # Prioritize explicit equations (e.g. "ETLS = V - (RTG + 60)") and definitions
                if re.search(rf"\b{re.escape(term)}\s*[:=]\s*[^\n]+", text):
                    score += 500.0
                if re.search(rf"\b{re.escape(term)}\b[^\n]*(?:is calculated|calculated in|is defined as)", t_low):
                    score += 500.0
            return score

        non_toc = [c for c in raw_candidates if not _is_toc(getattr(c.node, "text", "") or c.node.get_content())]
        pool = non_toc if non_toc else raw_candidates
        pool.sort(key=lambda n: -_relevance_score(n))
        return pool[: max(1, int(top_k))]

    retrieve_nodes._one_ead_multi = True
    module.retrieve_nodes = retrieve_nodes


def _prune_kb_versions(kb_dir: Path, keep_last: int = 2) -> None:
    try:
        import re
        import shutil

        if not kb_dir.is_dir():
            return
        flat_dirs = sorted(
            [d for d in kb_dir.iterdir() if d.is_dir() and re.match(r"^version-\d+$", d.name)],
            key=lambda x: int(re.search(r"\d+", x.name).group()),
        )
        if len(flat_dirs) > keep_last:
            for old_dir in flat_dirs[:-keep_last]:
                shutil.rmtree(old_dir, ignore_errors=True)
                print(f"[one-ead] automatically pruned old version: {old_dir.name} in {kb_dir.name}", flush=True)
    except Exception as exc:
        print(f"[one-ead] warning: failed to prune versions in {kb_dir.name}: {exc}", flush=True)


def _blue_green_slot(kb_dir: Path, module) -> str:
    """Return the alternating slot ('version-1' or 'version-2').

    If 'version-1' is the currently active/ready version, build into 'version-2'.
    If 'version-2' is active (or neither exists), build into 'version-1'.
    """
    try:
        latest = module._latest_ready_flat_version(kb_dir)
        latest_ver = latest.get("version") if latest else None
        if latest_ver == "version-1":
            return "version-2"
        elif latest_ver == "version-2":
            return "version-1"
        else:
            return "version-1"
    except Exception:
        return "version-1"


def _patch_versioning(module) -> None:
    if getattr(module, "_one_ead_bg_rotator", False):
        return

    def _next_flat_version_dir(kb_dir: Path) -> Path:
        slot = _blue_green_slot(Path(kb_dir), module)
        return Path(kb_dir) / slot

    def resolve_storage_dir_for_rebuild(
        kb_dir: Path, signature=None, *, publication_guard: bool = False
    ) -> Path:
        import shutil
        from deeptutor.services.file_io import atomic_write_json

        kb_path = Path(kb_dir)
        kb_path.mkdir(parents=True, exist_ok=True)
        slot = _blue_green_slot(kb_path, module)
        target = kb_path / slot

        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        target.mkdir(parents=True, exist_ok=True)

        if publication_guard:
            atomic_write_json(target / ".building.json", {"state": "building"})

        print(f"[one-ead] Blue/Green rotator assigned build slot: {target.name} for {kb_path.name}", flush=True)
        return target

    original_meta = getattr(module, "write_version_meta", None)
    def write_version_meta(kb_dir, signature, storage_dir=None):
        if original_meta:
            res = original_meta(kb_dir, signature, storage_dir=storage_dir)
        else:
            res = None
        _prune_kb_versions(Path(kb_dir), keep_last=2)
        return res

    module._next_flat_version_dir = _next_flat_version_dir
    module.resolve_storage_dir_for_rebuild = resolve_storage_dir_for_rebuild
    module.write_version_meta = write_version_meta
    module._one_ead_bg_rotator = True


# ---- generic query/document helpers (no document- or domain-specific knowledge) -------------------

_STOPWORDS = {
    "the", "and", "for", "with", "can", "you", "your", "their", "them", "they", "what", "which", "who",
    "how", "why", "when", "where", "does", "did", "are", "was", "were", "this", "that", "these", "those",
    "from", "into", "about", "between", "please", "give", "show", "tell", "list", "explain", "summarize",
    "summarise", "summary", "compare", "comparison", "table", "format", "value", "values", "each", "all",
    "also", "its", "has", "have", "any", "there", "here", "some", "more", "less", "than", "then", "use",
}
_ENTITY_RE = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]{1,8}-?\d{1,6}[A-Za-z0-9]*(?![A-Za-z0-9])")


def _norm_text(s: str) -> str:
    # "1 kHz" and "1kHz" compare equal without collapsing words like "20 and" -> "20and"
    return re.sub(r"(\d)\s+(?=(?:k?hz|db[a-z]*|v(?:pp)?|[u\u00b5\u03bc]?[avw]|pa|spl|%|[\u00b0\u00b5\u03bc\u03a9])\b)", r"\1", (s or "").lower())


def _query_entities(query: str) -> list[str]:
    """Identifier-like tokens in the question (part numbers, models, standard ids): letters + digits."""
    found: list[str] = []
    for m in _ENTITY_RE.finditer(query or ""):
        tok = m.group(0).upper()
        if tok not in found:
            found.append(tok)
    return found


def _query_terms(query: str) -> set[str]:
    ents = {e.lower() for e in _query_entities(query)}
    toks = re.findall(r"[a-z0-9][a-z0-9.+/-]*", _norm_text(query))
    return {t.strip(".,/-") for t in toks if len(t.strip(".,/-")) >= 3 and t not in _STOPWORDS and t not in ents}


def _term_overlap(text: str, terms: set[str]) -> int:
    t = _norm_text(text)
    unique_terms = sum(1 for term in terms if term in t)
    if unique_terms == 0:
        return 0
    # Prioritize chunks where query terms co-occur on lines with actual specification numbers
    value_lines = 0
    for line in t.split("\n"):
        matched = [term for term in terms if term in line]
        if len(matched) >= 2:
            line_no_terms = line
            for m in matched:
                line_no_terms = line_no_terms.replace(m, "")
            nums = re.findall(r"(?<![a-z0-9])[+-]?\d+(?:\.\d+)?(?![a-z0-9])", line_no_terms)
            if nums:
                value_lines += len(nums)
    return unique_terms * 100 + value_lines


def _entity_in(entity: str, s: str) -> bool:
    return bool(re.search(rf"(?<![A-Za-z0-9]){re.escape(entity)}(?![0-9])", s or "", re.IGNORECASE))


def _doc_name(node) -> str:
    meta = getattr(node, "metadata", {}) or {}
    return str(meta.get("file_name") or meta.get("title") or getattr(node, "ref_doc_id", None) or "")


def _patch_llamaindex_pipeline(module) -> None:
    import deeptutor.services.rag.index_versioning as iv
    if hasattr(iv, "resolve_storage_dir_for_rebuild"):
        module.resolve_storage_dir_for_rebuild = iv.resolve_storage_dir_for_rebuild

    cls = getattr(module, "LlamaIndexPipeline", None)
    if cls and not getattr(cls, "_one_ead_labeled_nodes", False):
        orig_nodes_to_result = cls._nodes_to_result

        def _nodes_to_result(self, query: str, nodes: list):
            res = orig_nodes_to_result(self, query, nodes)
            # Group chunks by document so all excerpts for a given part/model stay together
            groups: dict[str, list[str]] = {}
            for i, node in enumerate(nodes):
                meta = getattr(node.node, "metadata", {}) or {}
                fname = _doc_name(node.node) or f"Document {i + 1}"
                page = meta.get("page_label") or meta.get("page")
                page_str = f" (Page {page})" if page else ""
                text = _normalize_scrambled_formulas(getattr(node.node, "text", ""))
                groups.setdefault(fname, []).append(f"### [Document: {fname}{page_str}]\n{text}")

            context_parts = ["\n\n".join(chunks) for chunks in groups.values()]
            if context_parts:
                res["content"] = "\n\n".join(context_parts)
                res["answer"] = res["content"]
            return res

        cls._nodes_to_result = _nodes_to_result
        cls._one_ead_labeled_nodes = True


def _patch_language_directive(module) -> None:
    original = getattr(module, "language_directive", None)
    if original is None or getattr(original, "_one_ead_strict_en", False):
        return

    def language_directive(language: str | None, *, allow_user_override: bool = False) -> str:
        base = original(language, allow_user_override=allow_user_override)
        extra = (
            "\n\n[ENGINEERING ACCURACY & COMPARATIVE SYNTHESIS DIRECTIVE]\n"
            "1. ENGLISH REASONING: Conduct ALL internal thinking, chain-of-thought (<think>), and answers strictly and exclusively in ENGLISH. Never write Chinese/Mandarin in thinking or responses.\n"
            "2. COMPARATIVE SUMMARY TABLES & PARAMETER FOCUS: When the user asks to summarize, compare, or tabulate multiple parts, models, or items across specific parameters (e.g. sensitivity at 1kHz and 10kHz):\n"
            "   - You MUST produce a SINGLE unified comparative Markdown table where each requested model/item is a row, and each requested parameter is a column.\n"
            "   - Extract ONLY the specific parameters requested by the user. NEVER transcribe or dump unrelated parameters or sections from the source datasheets (e.g., if the user asks for sensitivity, do NOT output mechanical specifications, dimensions, pinouts, port locations, capacitors, supply current, roll-off, peak frequency, or output impedance).\n"
            "   - For each item, extract its parameter value strictly from that item's own document passage under '### [Document: ...]'. If a parameter is missing for an item, write 'Not specified' in that cell.\n"
            "   - Keep the Nominal/Typical value by default, and always include the exact units and reference condition verbatim (e.g. 'dB re 1V / 1 Pa', 'dB re 1V / 0.1 Pa', 'dB re sensitivity @ 1kHz').\n"
            "   - Preserve positive (+) and negative (-) signs verbatim (e.g. +1.5 dB, -35.0 dB).\n"
            "3. VERBATIM QUOTE-FIRST GROUNDING (ZERO-HALLUCINATION PROTOCOL):\n"
            "   - In your internal thinking/scratchpad, before extracting any numerical parameter into the final table or response, you MUST first locate and quote the verbatim line from that specific item's document excerpt (e.g. quote: 'Sensitivity: Condition / Frequency = 1 kHz; Min = -40.5; Nom = -37.5; Max = -34.5').\n"
            "   - STRICT ENTITY ISOLATION: A value or line found under '### [Document: ...MM60...]' belongs ONLY to MM60. It is STRICTLY FORBIDDEN to use a value from one document to fill in a table row or parameter for another document/model.\n"
            "   - MISSING PARAMETERS: If an item's document does not contain an explicit line with the requested parameter and a numerical value, you MUST write 'Not specified' in that cell. NEVER guess, estimate, or extrapolate from other models.\n"
            "   - NUMERICAL INTEGRITY: Copy digits, decimals, and signs (+ or -) exactly as written in the quoted line. Do not round, fabricate, or alter values.\n"
            "4. VERBATIM FORMULAS & EQUATIONS (ZERO-HALLUCINATION DERIVATIONS):\n"
            "   - When asked for a calculation, formula, or definition, locate the governing normative definition clause in the provided standard and quote the EXACT formula verbatim (e.g. Clause 9.5.7: 'ETLS = V - (RTG + 60)' where V is HFA-SPLIV). Never algebraically rearrange, invert, or invent formulas.\n"
            "   - DISTINGUISH MEASUREMENT FORMULAS VS EQUIVALENCE CONDITIONS: If a document contains a primary measurement formula (e.g. Clause 9.5.7: ETLS = V - (RTG + 60)) and an in-situ target equivalence condition (e.g. Annex C.3.4: ETLS = HFA-MLE where HFA-MLE is selected from Table C.1), always present the primary measurement formula first, and explicitly clarify that Annex C provides the target for in-situ equivalence.\n"
            "   - HYPHENATED TERMS ARE NOT ARITHMETIC SUBTRACTIONS: Compound acronyms (such as HFA-MLE, HFA-SPLIV, HFA-SPLITS) are single compound parameter names, NEVER arithmetic subtractions. Never write 'HFA - MLE' as a subtraction.\n"
            "   - CLEAN ENGINEERING SYMBOLS & NOTATION:\n"
            "     * Never output raw LaTeX markup or math commands (strictly NO '$', '$$', '\\(', '\\)', '\\[', '\\]', '\\frac', '\\times', '\\cdot', '\\pm', '\\mu', '\\Omega').\n"
            "     * Present all formulas and equations as clean, readable text or inline code blocks (e.g. `ETLS = V - (RTG + 60)`).\n"
            "     * Use standard UTF-8 characters for units and tolerances: '±' (not '\\pm' or '+/-'), 'µ' (not '\\mu' or 'u'), 'Ω' (not '\\Omega' or 'ohm'), '≤', '≥', '°C'.\n"
            "     * Wrap variable names containing underscores in backticks (e.g. `V_DD`, `HFA_SPLIV`) so Markdown does not corrupt them into italics.\n"
            "5. NO SILENT CONVERSION: Never convert, normalise or re-reference a value unless the user asks. If one document uses a different reference condition than another (e.g. dB re 1V/1Pa vs dB re 1V/0.1Pa), report each value with its own reference.\n"
            "6. CLEAN MARKDOWN & DIRECT DELIVERY: Always format tables using standard GitHub Markdown table syntax (| Header 1 | Header 2 |). NEVER use LaTeX syntax such as \\begin{array} or \\begin{tabular} or $$ delimiters for tables. Output the summary table immediately without long preambles, repeated document listings, or dumping unrelated specification tables."
        )
        return base + extra

    language_directive._one_ead_strict_en = True
    module.language_directive = language_directive


def _patch_reasoning_params(module) -> None:
    original_build = getattr(module, "build_openai_compatible_reasoning_kwargs", None)

    def build_openai_compatible_reasoning_kwargs(
        *,
        spec=None,
        binding=None,
        model=None,
        reasoning_effort=None,
    ) -> dict:
        provider_name = str(getattr(spec, "name", None) or binding or "").strip().lower()
        model_name = str(model or "").strip().lower()
        res = {}
        if original_build:
            res = original_build(
                spec=spec,
                binding=binding,
                model=model,
                reasoning_effort=reasoning_effort,
            ) or {}
        if provider_name == "ollama" or "qwen" in model_name or "llama" in model_name or "gemma" in model_name:
            if not reasoning_effort or str(reasoning_effort).strip().lower() in ("none", "minimal"):
                res["reasoning_effort"] = "none"
                res.setdefault("extra_body", {})["think"] = False
        return res

    module.build_openai_compatible_reasoning_kwargs = build_openai_compatible_reasoning_kwargs
    module.default_reasoning_effort_for = lambda provider, model: "none"


def _patch_sqlite_store(module) -> None:
    cls = getattr(module, "SQLiteSessionStore", None)
    if cls and not getattr(cls, "_one_ead_fast_store", False):
        import time
        orig_add = cls.add_message
        orig_trace = getattr(cls, "_canonical_trace_preview_sync", None)
        orig_list = getattr(cls, "_list_sessions_sync", None)
        orig_get_with_msgs = getattr(cls, "get_session_with_messages", None)
        orig_del = getattr(cls, "delete_session", None)
        orig_rename = getattr(cls, "update_session_title", None)

        _TRACE_PREVIEW_CACHE = {}
        _SESSION_CACHE = {}
        _LIST_CACHE = {}

        def _invalidate(session_id: str | None = None):
            _LIST_CACHE.clear()
            if session_id:
                _SESSION_CACHE.pop(session_id, None)

        async def add_message(self, session_id, role, content, *args, **kwargs):
            if role == "assistant" and isinstance(content, str):
                content = _clean_stray_math(content)
            _invalidate(session_id)
            return await orig_add(self, session_id, role, content, *args, **kwargs)

        cls.add_message = add_message

        if orig_del:
            async def delete_session(self, session_id, *args, **kwargs):
                _invalidate(session_id)
                return await orig_del(self, session_id, *args, **kwargs)
            cls.delete_session = delete_session

        if orig_rename:
            async def update_session_title(self, session_id, title, *args, **kwargs):
                _invalidate(session_id)
                return await orig_rename(self, session_id, title, *args, **kwargs)
            cls.update_session_title = update_session_title

        if orig_trace:
            def _canonical_trace_preview_sync(self, conn, turn_id, session_id):
                hit = _TRACE_PREVIEW_CACHE.get(turn_id)
                if hit is not None:
                    preview, meta = hit
                    return [dict(e, session_id=session_id) for e in preview], dict(meta)
                preview, meta = orig_trace(self, conn, turn_id, session_id)
                if meta.get("ended_at") or meta.get("last_seq"):
                    _TRACE_PREVIEW_CACHE[turn_id] = (preview, meta)
                return preview, meta
            cls._canonical_trace_preview_sync = _canonical_trace_preview_sync

        if orig_list:
            def _list_sessions_sync(self, limit=50, offset=0, workspace_id=None):
                key = (limit, offset, workspace_id)
                hit = _LIST_CACHE.get(key)
                now = time.time()
                if hit and now - hit[0] < 3.0:
                    return hit[1]
                rows = orig_list(self, limit, offset, workspace_id)
                _LIST_CACHE[key] = (now, rows)
                return rows
            cls._list_sessions_sync = _list_sessions_sync

        if orig_get_with_msgs:
            async def get_session_with_messages(self, session_id: str):
                sess = await self.get_session(session_id)
                if sess is None:
                    return None
                upd = sess.get("updated_at")
                hit = _SESSION_CACHE.get(session_id)
                if hit is not None:
                    hit_upd, hit_data = hit
                    if hit_upd == upd and not sess.get("active_turn_id"):
                        res = dict(hit_data)
                        res["active_turns"] = []
                        return res
                from deeptutor.services.session.provider_response_state import redact_private_message_metadata
                sess["messages"] = await self.get_messages(session_id)
                redact_private_message_metadata(sess["messages"])
                sess["active_turns"] = await self.list_active_turns(session_id)
                if not sess.get("active_turns") and not sess.get("active_turn_id"):
                    _SESSION_CACHE[session_id] = (upd, dict(sess))
                return sess
            cls.get_session_with_messages = get_session_with_messages

        orig_connect = cls._connect
        def _connect(self):
            conn = orig_connect(self)
            if not getattr(self, "_one_ead_indexes_checked", False):
                try:
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_turn_events_preview ON turn_events(turn_id, seq DESC) WHERE type IN ('done', 'error', 'cancelled', 'result', 'tool_call', 'tool_result')")
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_turn_events_turn_type ON turn_events(turn_id, type)")
                    conn.commit()
                except Exception:
                    pass
                self._one_ead_indexes_checked = True
            return conn
        cls._connect = _connect
        cls._one_ead_fast_store = True


def _patch_document_extractor(module) -> None:
    orig = getattr(module, "_extract_pdf", None)
    if orig and not getattr(orig, "_one_ead_sorted", False):
        def _extract_pdf_sorted(data: bytes, filename: str) -> str:
            try:
                import pymupdf as fitz
                with fitz.open(stream=data, filetype="pdf") as doc:
                    if doc.is_encrypted and not doc.authenticate(""):
                        raise module.CorruptDocumentError(f"{filename} is encrypted and cannot be read", filename=filename)
                    pages = [
                        f"--- Page {i} ---\n{_normalize_scrambled_formulas((page.get_text('text', sort=True) or '').replace('\u2212', '-'))}"
                        for i, page in enumerate(doc, 1)
                    ]
                pdf_images = getattr(module, "extract_pdf_images", None)
                if pdf_images:
                    img_data = pdf_images(data)
                    if getattr(img_data, "collection", None) and getattr(img_data.collection, "images", None):
                        marker_by_page = {}
                        build_marker = getattr(module, "build_marker", lambda x: "")
                        for page_number, indices in img_data.page_map:
                            marker_by_page[page_number] = [
                                build_marker(img_data.collection.images[index]) for index in indices
                            ]
                        pages = [
                            p_txt + ("\n" + "\n".join(marker_by_page[i]) if i in marker_by_page else "")
                            for i, p_txt in enumerate(pages, 1)
                        ]
                        note = img_data.collection.summary_note()
                        if note:
                            pages.append(note)
                return "\n\n".join(pages)
            except Exception:
                return orig(data, filename)

        _extract_pdf_sorted._one_ead_sorted = True
        module._extract_pdf = _extract_pdf_sorted


_PATCHES = {
    "deeptutor.utils.document_extractor": _patch_document_extractor,
    "deeptutor.services.parsing.engines.text_only.engine": _patch_text_parser,
    "deeptutor.services.embedding.adapters.ollama": _patch_ollama_adapter,
    "deeptutor.services.rag.embedding_signature": _patch_signature,
    "deeptutor.services.rag.index_versioning": _patch_versioning,
    "deeptutor.agents.loop.pipeline": _patch_agent_pipeline,
    "deeptutor.agents.chat.agentic_pipeline": _patch_chat_pipeline,
    "deeptutor.services.rag.pipelines.llamaindex.rerank": _patch_reranker,
    "deeptutor.services.rag.pipelines.llamaindex.retrievers": _patch_retrievers,
    "deeptutor.services.rag.pipelines.llamaindex.pipeline": _patch_llamaindex_pipeline,
    "deeptutor.services.prompt.language": _patch_language_directive,
    "deeptutor.services.llm.reasoning_params": _patch_reasoning_params,
    "deeptutor.services.session.sqlite_store": _patch_sqlite_store,
}


class _PatchingLoader(importlib.abc.Loader):
    def __init__(self, inner, patch):
        self._inner, self._patch = inner, patch

    def create_module(self, spec):
        return self._inner.create_module(spec)

    def exec_module(self, module):
        self._inner.exec_module(module)
        try:
            self._patch(module)
        except Exception as exc:
            print(f"[one-ead] hook for {module.__name__} not installed: {exc}", flush=True)


class _Finder(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path, target=None):
        patch = _PATCHES.get(name)
        if patch is None:
            return None
        spec = importlib.machinery.PathFinder.find_spec(name, path)
        if spec is not None and spec.loader is not None:
            spec.loader = _PatchingLoader(spec.loader, patch)
        return spec


sys.meta_path.insert(0, _Finder())
