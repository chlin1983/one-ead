"""Parser for ``.hxml`` measurement files (reused from the eadtools desktop app).

The format is XML: ``hxml > data > dataset > v-curvedata > curvedata`` where each
``curvedata`` holds one or more ``curve`` elements. A curve's text is a
whitespace separated list of numbers wrapped in square brackets, e.g.
``[100 106 112 ...]``. Some curves are scalars (a single value) and some hold
non-numeric data (complex numbers / matrices); those are preserved but flagged so
the UI can decide how to present them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List
import xml.etree.ElementTree as ET


@dataclass
class Curve:
    name: str
    unit: str
    raw: str
    values: List[float] = field(default_factory=list)
    is_numeric: bool = False

    @property
    def is_scalar(self) -> bool:
        return self.is_numeric and len(self.values) == 1

    @property
    def is_series(self) -> bool:
        return self.is_numeric and len(self.values) > 1


@dataclass
class CurveData:
    name: str
    attributes: Dict[str, str] = field(default_factory=dict)
    curves: List[Curve] = field(default_factory=list)

    def curve(self, name: str) -> "Curve | None":
        for c in self.curves:
            if c.name == name:
                return c
        return None


@dataclass
class DataSet:
    working_title: str = ""
    curve_data: List[CurveData] = field(default_factory=list)


@dataclass
class HxmlDocument:
    path: str = ""
    data_type: str = ""
    data_version: str = ""
    datasets: List[DataSet] = field(default_factory=list)

    @property
    def name(self) -> str:
        import os

        return os.path.basename(self.path) if self.path else "(unsaved)"


def _parse_values(raw: str) -> "tuple[List[float], bool]":
    text = raw.strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    text = text.strip()
    if not text:
        return [], False
    if ";" in text or "i" in text:  # matrices / complex numbers - not plottable
        return [], False

    values: List[float] = []
    for token in text.split():
        try:
            values.append(float(token))
        except ValueError:
            return [], False
    return values, True


def _parse_curve(elem: ET.Element) -> Curve:
    raw = elem.text or ""
    values, is_numeric = _parse_values(raw)
    return Curve(
        name=elem.get("name", ""),
        unit=elem.get("unit", ""),
        raw=raw.strip(),
        values=values,
        is_numeric=is_numeric,
    )


def parse_hxml(path: str) -> HxmlDocument:
    tree = ET.parse(path)
    root = tree.getroot()
    doc = HxmlDocument(path=path)

    head = root.find("head/Document")
    if head is not None:
        dtype = head.find("DataType")
        dver = head.find("DataVersion")
        doc.data_type = (dtype.text or "").strip() if dtype is not None else ""
        doc.data_version = (dver.text or "").strip() if dver is not None else ""

    data = root.find("data")
    if data is None:
        return doc

    for dataset_elem in data.findall("dataset"):
        dataset = DataSet(working_title=dataset_elem.get("WorkingTitle", ""))
        for cd_elem in dataset_elem.findall(".//curvedata"):
            cd = CurveData(
                name=cd_elem.get("CurveDataName", "(unnamed)"),
                attributes=dict(cd_elem.attrib),
            )
            for curve_elem in cd_elem.findall("curve"):
                cd.curves.append(_parse_curve(curve_elem))
            dataset.curve_data.append(cd)
        doc.datasets.append(dataset)

    return doc


def parse_hxml_bytes(data: bytes, name: str) -> HxmlDocument:
    """Parse ``.hxml`` content from raw bytes (as uploaded to the portal)."""
    root = ET.fromstring(data)
    doc = HxmlDocument(path=name)

    head = root.find("head/Document")
    if head is not None:
        dtype = head.find("DataType")
        dver = head.find("DataVersion")
        doc.data_type = (dtype.text or "").strip() if dtype is not None else ""
        doc.data_version = (dver.text or "").strip() if dver is not None else ""

    data_elem = root.find("data")
    if data_elem is None:
        return doc

    for dataset_elem in data_elem.findall("dataset"):
        dataset = DataSet(working_title=dataset_elem.get("WorkingTitle", ""))
        for cd_elem in dataset_elem.findall(".//curvedata"):
            cd = CurveData(
                name=cd_elem.get("CurveDataName", "(unnamed)"),
                attributes=dict(cd_elem.attrib),
            )
            for curve_elem in cd_elem.findall("curve"):
                cd.curves.append(_parse_curve(curve_elem))
            dataset.curve_data.append(cd)
        doc.datasets.append(dataset)

    return doc


def pick_x_curve(cd: CurveData) -> "Curve | None":
    """Choose the most sensible x-axis series for a curvedata block."""
    series = [c for c in cd.curves if c.is_series]
    if not series:
        return None
    for preferred in ("f", "t", "inputLevel", "f48"):
        for c in series:
            if c.name == preferred:
                return c
    return max(series, key=lambda c: len(c.values))
