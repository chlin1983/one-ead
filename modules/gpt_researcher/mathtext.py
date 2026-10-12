"""Turns LaTeX math that local models like to write into plain Unicode text.

Reports are shown as Markdown without a math renderer, so ``$5.3 \\times 3.1 \\text{ mm}$`` would appear
literally. ``clean_math`` rewrites such spans (``$...$``, ``$$...$$``, ``\\(...\\)``, ``\\[...\\]``) to
``5.3 × 3.1 mm``. It is idempotent and leaves ordinary dollar amounts alone.
"""

from __future__ import annotations

import re

_GREEK = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "zeta": "ζ", "eta": "η",
    "theta": "θ", "kappa": "κ", "lambda": "λ", "mu": "µ", "nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ",
    "tau": "τ", "phi": "φ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
    "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π", "Sigma": "Σ", "Phi": "Φ",
    "Psi": "Ψ", "Omega": "Ω",
}
_SYMBOLS = {
    "times": "×", "cdot": "·", "pm": "±", "mp": "∓", "approx": "≈", "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥",
    "ne": "≠", "neq": "≠", "to": "→", "rightarrow": "→", "leftarrow": "←", "infty": "∞", "circ": "°", "deg": "°",
    "sim": "~", "propto": "∝", "ldots": "…", "dots": "…", "cdots": "…", "partial": "∂", "nabla": "∇",
    "quad": " ", "qquad": " ", "left": "", "right": "", "displaystyle": "", "mathrm": "", "rm": "",
}
_SUP = str.maketrans("0123456789+-n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ")
_SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
_WRAPPERS = r"text|textbf|textit|textrm|mathrm|mathbf|mathit|operatorname|mbox|boldsymbol|bm"

_DISPLAY = re.compile(r"\$\$(.+?)\$\$|\\\[(.+?)\\\]", re.S)
_PAREN = re.compile(r"\\\((.+?)\\\)", re.S)
_INLINE = re.compile(r"(?<![\\$])\$([^$\n]{1,300}?)(?<![\\$])\$(?!\$)")
_PLAIN_VAR = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,3}")


def _tex_to_text(tex: str) -> str:
    s = tex.replace(r"^{\circ}", "°").replace(r"^\circ", "°")
    s = re.sub(r"\\([A-Za-z]+)(?![A-Za-z])", lambda m: _SYMBOLS.get(m.group(1), _GREEK.get(m.group(1), m.group(0))), s)
    s = re.sub(r"\^\{([0-9+\-n]+)\}", lambda m: m.group(1).translate(_SUP), s)
    s = re.sub(r"\^([0-9n])", lambda m: m.group(1).translate(_SUP), s)
    s = re.sub(r"\^\{([^{}]*)\}", r"^(\1)", s)
    s = re.sub(r"_\{([0-9]+)\}", lambda m: m.group(1).translate(_SUB), s)
    s = re.sub(r"_([0-9])", lambda m: m.group(1).translate(_SUB), s)
    s = re.sub(r"_\{([^{}]*)\}", r"_\1", s)
    for _ in range(3):  # nested wrappers / fractions
        s = re.sub(rf"\\(?:{_WRAPPERS})\s*\{{([^{{}}]*)\}}", r"\1", s)
        s = re.sub(r"\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"(\1)/(\2)", s)
        s = re.sub(r"\\sqrt\s*\{([^{}]*)\}", r"√(\1)", s)
    s = re.sub(r"\\[,;:! ]", " ", s)
    s = re.sub(r"\\([%$_&#{}])", r"\1", s)
    s = re.sub(r"\\([A-Za-z]+)", r"\1", s)  # unknown commands such as \log keep their name
    s = s.replace("{", "").replace("}", "")
    return re.sub(r"[ \t]+", " ", s).strip()


def _inline(match: re.Match) -> str:
    body = match.group(1)
    if "\\" in body or re.search(r"[\^_]\{", body) or re.match(r"\s*[\^_]", body) or _PLAIN_VAR.fullmatch(body.strip()):
        return _tex_to_text(body)
    return match.group(0)  # e.g. "$5 to $10" is money, not math


def clean_math(text: str) -> str:
    if "$" not in text and "\\(" not in text and "\\[" not in text:
        return text
    text = _DISPLAY.sub(lambda m: "\n\n" + _tex_to_text(m.group(1) or m.group(2)) + "\n\n", text)
    text = _PAREN.sub(lambda m: _tex_to_text(m.group(1)), text)
    return _INLINE.sub(_inline, text)
