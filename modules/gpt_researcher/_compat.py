"""Checks that the installed gpt-researcher still offers everything this plugin relies on.

Runs inside the engine's private venv, either at the start of every research job (``_run_research.py``)
or as ``python _compat.py <config.json> [--deep]`` to vet a staged engine update. ``check`` returns
``(errors, warnings)``: an error means a job would break or silently behave differently.
"""

from __future__ import annotations

import importlib
import inspect
import json
import sys

# Config keys whose loss would silently change privacy or model behaviour.
HARD_KEYS = {"FAST_LLM", "SMART_LLM", "STRATEGIC_LLM", "EMBEDDING", "RETRIEVER", "REPORT_SOURCE", "DOC_PATH",
             "LLM_KWARGS", "CONTEXT_FILTER", "MCP_STRATEGY"}
RESEARCHER_PARAMS = ("query", "report_type", "report_source", "tone", "websocket", "agent", "role",
                     "max_subtopics", "verbose")
OLLAMA_FIELDS = ("model", "base_url", "temperature", "num_ctx", "num_predict", "reasoning")
SEND_PARAMS = ("request", "stream", "timeout", "verify", "cert", "proxies")


def _params(func) -> tuple[set, bool]:
    sig = inspect.signature(func)
    return set(sig.parameters), any(p.kind is p.VAR_KEYWORD for p in sig.parameters.values())


def check(config_path: str, deep: bool = False) -> tuple[list, list]:
    errors: list = []
    warnings: list = []
    try:
        with open(config_path, encoding="utf-8") as fh:
            wanted = json.load(fh)
    except Exception as exc:
        return [f"Cannot read the job configuration: {exc}"], warnings

    try:
        from gpt_researcher import GPTResearcher
        names, var_kw = _params(GPTResearcher.__init__)
        missing = [p for p in RESEARCHER_PARAMS if p not in names]
        if missing and not var_kw:
            errors.append(f"GPTResearcher no longer accepts: {', '.join(missing)}")
        for method, is_async in (("conduct_research", True), ("write_report", True), ("get_source_urls", False)):
            func = getattr(GPTResearcher, method, None)
            if not callable(func):
                errors.append(f"GPTResearcher.{method}() is missing")
            elif inspect.iscoroutinefunction(func) != is_async:
                errors.append(f"GPTResearcher.{method}() changed between sync and async")
    except Exception as exc:
        errors.append(f"Cannot import GPTResearcher: {type(exc).__name__}: {exc}")

    try:
        from gpt_researcher.utils.enum import Tone
        if not any(t.name == "Objective" for t in Tone):
            errors.append("Tone.Objective is missing")
    except Exception as exc:
        errors.append(f"Cannot import Tone: {type(exc).__name__}: {exc}")

    try:
        from gpt_researcher.context.lexical import bm25_scores
        if len(_params(bm25_scores)[0]) < 2:
            errors.append("bm25_scores() signature changed")
    except Exception as exc:
        errors.append(f"Cannot import bm25_scores (detailed reports): {type(exc).__name__}: {exc}")

    try:
        from langchain_ollama import ChatOllama
        absent = [f for f in OLLAMA_FIELDS if f not in ChatOllama.model_fields]
        if absent:
            errors.append(f"ChatOllama no longer has: {', '.join(absent)}")
    except Exception as exc:
        errors.append(f"Cannot import ChatOllama: {type(exc).__name__}: {exc}")

    try:
        from requests.adapters import HTTPAdapter
        absent = [p for p in SEND_PARAMS if p not in _params(HTTPAdapter.send)[0]]
        if absent:
            errors.append(f"requests HTTPAdapter.send() changed ({', '.join(absent)}); the web-safety patch would fail")
    except Exception as exc:
        errors.append(f"Cannot inspect requests: {type(exc).__name__}: {exc}")

    try:
        from gpt_researcher.config.variables.default import DEFAULT_CONFIG
        for key in wanted:
            if key not in DEFAULT_CONFIG:
                (errors if key in HARD_KEYS else warnings).append(f"Config key {key} is no longer recognised and would be ignored")
    except Exception as exc:
        warnings.append(f"Cannot read the engine's default config: {type(exc).__name__}: {exc}")

    try:
        from gpt_researcher.config.config import Config
        cfg = Config(config_path)
        pairs = [("fast_llm", "FAST_LLM"), ("smart_llm", "SMART_LLM"), ("strategic_llm", "STRATEGIC_LLM")]
        for attr, key in pairs:
            if key in wanted:
                provider, _, model = str(wanted[key]).partition(":")
                if (getattr(cfg, f"{attr}_provider", None), getattr(cfg, f"{attr}_model", None)) != (provider, model):
                    errors.append(f"{key} was not applied as configured ({wanted[key]})")
        if "EMBEDDING" in wanted:
            provider, _, model = str(wanted["EMBEDDING"]).partition(":")
            if (getattr(cfg, "embedding_provider", None), getattr(cfg, "embedding_model", None)) != (provider, model):
                errors.append("EMBEDDING was not applied as configured")
        for key in ("LLM_KWARGS", "CONTEXT_FILTER", "REPORT_SOURCE", "MCP_STRATEGY"):
            if key in wanted and getattr(cfg, key.lower(), None) != wanted[key]:
                errors.append(f"{key} was not applied as configured")
        retrievers = [r.strip() for r in str(wanted.get("RETRIEVER", "")).split(",") if r.strip()]
        if retrievers and list(getattr(cfg, "retrievers", [])) != retrievers:
            errors.append(f"Retrievers were not applied as configured ({retrievers} -> {getattr(cfg, 'retrievers', None)})")
        if "SCRAPER_RATE_LIMIT_DELAY" in wanted and not hasattr(cfg, "scraper_rate_limit_delay"):
            warnings.append("SCRAPER_RATE_LIMIT_DELAY is not applied")
    except Exception as exc:
        errors.append(f"Cannot load the job configuration into the engine: {type(exc).__name__}: {exc}")

    try:
        from gpt_researcher.actions.retriever import get_retriever
        for name in [r.strip() for r in str(wanted.get("RETRIEVER", "")).split(",") if r.strip()]:
            if get_retriever(name) is None:
                errors.append(f"Retriever {name!r} is no longer available")
            elif name == "duckduckgo":
                importlib.import_module("ddgs")
    except Exception as exc:
        errors.append(f"Retriever check failed: {type(exc).__name__}: {exc}")

    if deep:
        for module in ("pymupdf", "mistune"):
            try:
                importlib.import_module(module)
            except Exception as exc:
                warnings.append(f"{module} is not importable, so PDF export would fail ({type(exc).__name__})")
    return errors, warnings


def main() -> int:
    errors, warnings = check(sys.argv[1], deep="--deep" in sys.argv[2:])
    print("@@compat " + json.dumps({"errors": errors, "warnings": warnings}), flush=True)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
