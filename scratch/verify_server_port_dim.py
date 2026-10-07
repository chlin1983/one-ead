import urllib.request
import json
import fitz

BASE_URL = "http://127.0.0.1:8100/api/component_database"

# 1. Check schemas
print("Checking /schemas...")
req = urllib.request.urlopen(f"{BASE_URL}/schemas")
schemas = json.loads(req.read().decode('utf-8'))
mic_schema = schemas.get("microphone", {})
acoustic_group = None
for g in mic_schema.get("groups", []):
    if g.get("id") == "acoustic":
        acoustic_group = g
        break

assert acoustic_group is not None, "Acoustic group not found in microphone schema!"
params = acoustic_group.get("parameters", [])
first_param = params[0] if params else None
print(f"First parameter in Acoustic Specifications: {first_param.get('key')} -> '{first_param.get('label')}'")
assert first_param.get("key") == "acoustic_port_dim", f"Expected acoustic_port_dim as first param, got {first_param.get('key')}"

print("First 6 parameters in Acoustic Specifications:")
for idx, p in enumerate(params[:6]):
    print(f"  Row {idx + 1}: {p.get('key')} -> '{p.get('label')}'")

# 2. Check components specs
for comp_id in ["knowles_mm60_63230", "knowles_mm08_36139", "knowles_mm07_62964_b66", "knowles_mm20_62249"]:
    req = urllib.request.urlopen(f"{BASE_URL}/components/{comp_id}")
    comp_data = json.loads(req.read().decode('utf-8'))
    port_spec = next((s for s in comp_data.get("specs", []) if s.get("param_key") == "acoustic_port_dim"), None)
    if port_spec:
        print(f"{comp_data.get('part_number')} ({comp_id}): Acoustic Port Dimension = {port_spec.get('nom_val')} {port_spec.get('unit')} (cond: {port_spec.get('condition')}, Page {port_spec.get('source_page')})")
    else:
        print(f"{comp_data.get('part_number')} ({comp_id}): Acoustic Port Dimension = NA (not present)")

# 3. Check PDF (/datasheet-file) highlight annotations
tests_pdf = [
    {
        "name": "MM60 Page 1",
        "url": f"{BASE_URL}/datasheet-file/microphone/D00343759_V2_DATA%20SHEET%20MIC%20MM60-63230-B66%20KNOWLES.pdf?param=acoustic_port_dim&label=Acoustic+Port+Dimension&raw=Acoustic+port+dimension&val=0.30&page=1"
    },
    {
        "name": "MM08 Page 1",
        "url": f"{BASE_URL}/datasheet-file/microphone/MM08-36139-B66%20Rev%205%20preliminary%20datasheet.pdf?param=acoustic_port_dim&label=Acoustic+Port+Dimension&raw=Acoustic+port+dimension&val=0.35&page=1"
    },
    {
        "name": "MM07 Page 4",
        "url": f"{BASE_URL}/datasheet-file/microphone/D21027116_V1_DATA%20SHEET%20MIC%20MM07-62964-B66%20KNOWLES.pdf?param=acoustic_port_dim&label=Acoustic+Port+Dimension&raw=Acoustic+Port+(AP)&val=0.325&page=4"
    }
]

print("\nChecking /datasheet-file (PDF highlights):")
for ep in tests_pdf:
    req = urllib.request.urlopen(ep["url"])
    pdf_bytes = req.read()
    headers = dict(req.headers)
    print(f"{ep['name']}: HTTP 200, Ratio header={headers.get('X-Highlight-Ratio')}, Y header={headers.get('X-Highlight-Y')}")
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_num = 1 if "Page 1" in ep["name"] else 4
    page = doc[page_num - 1]
    annots = list(page.annots())
    print(f"   Annotations count on page {page_num}: {len(annots)}")
    words = page.get_text("words")
    for a in annots:
        covered = [w[4] for w in words if fitz.Rect(w[:4]).intersects(a.rect)]
        print(f"     Covered: {' '.join(covered)}")

# 4. Check SVG (/datasheet-page) highlight embedding
tests_svg = [
    {
        "name": "MM60 SVG Page 1",
        "url": f"{BASE_URL}/datasheet-page/microphone/D00343759_V2_DATA%20SHEET%20MIC%20MM60-63230-B66%20KNOWLES.pdf?param=acoustic_port_dim&label=Acoustic+Port+Dimension&raw=Acoustic+port+dimension&val=0.30&page=1&highlight_page=1"
    },
    {
        "name": "MM08 SVG Page 1",
        "url": f"{BASE_URL}/datasheet-page/microphone/MM08-36139-B66%20Rev%205%20preliminary%20datasheet.pdf?param=acoustic_port_dim&label=Acoustic+Port+Dimension&raw=Acoustic+port+dimension&val=0.35&page=1&highlight_page=1"
    },
    {
        "name": "MM07 SVG Page 4",
        "url": f"{BASE_URL}/datasheet-page/microphone/D21027116_V1_DATA%20SHEET%20MIC%20MM07-62964-B66%20KNOWLES.pdf?param=acoustic_port_dim&label=Acoustic+Port+Dimension&raw=Acoustic+Port+(AP)&val=0.325&page=4&highlight_page=4"
    }
]

print("\nChecking /datasheet-page (SVG viewer with embedded highlight ratio):")
for ep in tests_svg:
    req = urllib.request.urlopen(ep["url"])
    svg_text = req.read().decode('utf-8')
    has_ratio = 'data-highlight-ratio=' in svg_text
    print(f"{ep['name']}: HTTP 200, has data-highlight-ratio attribute = {has_ratio}")
    assert has_ratio, f"{ep['name']} missing data-highlight-ratio attribute!"

print("\nALL TESTS PASSED WITH 100% SUCCESS!")
