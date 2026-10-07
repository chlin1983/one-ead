import fitz
from pathlib import Path

pdf_path = Path("modules/component_database/microphone/D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf")

def highlight_test(raw_label, param_key, param_label, val, min_val=None, max_val=None, page_num=4):
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]
    
    # 1. Tier 1: direct raw candidates
    tier1 = []
    if raw_label:
        s = raw_label.replace("ti me", "time").replace("Dr ain", "Drain")
        base = s.split(" - ")[0].split(" (")[0].strip()
        tier1.append(base)
        tier1.append(base.lstrip("*•- ").strip())
        words = base.split()
        if len(words) > 1 and words[-1].lower() in ("tr", "toff", "tld", "vt", "ipk", "tpw", "vl", "idd", "zout"):
            shorter = " ".join(words[:-1])
            tier1.append(shorter)
            tier1.append(shorter.lstrip("*•- ").strip())
    tier1 = sorted(list(dict.fromkeys(tier1)), key=lambda x: len(x), reverse=True)
    
    # 2. Tier 2: canonical candidates
    tier2 = []
    if param_label:
        tier2.append(param_label)
        tier2.append(param_label.lstrip("*•- ").strip())
    
    words = page.get_text("words")
    
    # Collect non-placeholder target values
    target_values = []
    for candidate in [val, nom if 'nom' in locals() else None, max_val, min_val]:
        if candidate is not None:
            c_str = str(candidate).strip()
            if c_str and c_str not in ("-", "--", "TBD", "N/A", "None", "n/a"):
                c_clean = c_str.rstrip("0").rstrip(".") if "." in c_str else c_str
                target_values.append((c_str, c_clean))
                
    found_rect = None
    
    # Search Tier 1 first
    for a in tier1:
        rects = page.search_for(a)
        if not rects:
            continue
        # If target values exist, pick the rect whose line contains a value
        if target_values:
            for r in rects:
                y_mid = (r.y0 + r.y1) / 2
                row_words = [w[4].strip() for w in words if abs((w[1] + w[3]) / 2 - y_mid) < 7]
                for v_str, v_clean in target_values:
                    for w in row_words:
                        w_clean = w.rstrip("0").rstrip(".") if "." in w else w
                        if v_clean == w_clean or v_str == w:
                            found_rect = r
                            break
                    if found_rect:
                        break
                if found_rect:
                    break
        if not found_rect:
            t_rects = [r for r in rects if r.y0 > 80]
            found_rect = t_rects[0] if t_rects else rects[0]
        if found_rect:
            break
            
    # Search Tier 2 only if Tier 1 found nothing
    if not found_rect:
        for a in tier2:
            rects = page.search_for(a)
            if rects:
                t_rects = [r for r in rects if r.y0 > 80]
                found_rect = t_rects[0] if t_rects else rects[0]
                break
                
    print(f"[{raw_label[:30]}...] Found rect: {found_rect}")
    if found_rect:
        y_mid = (found_rect.y0 + found_rect.y1) / 2
        row_words = [w for w in words if abs((w[1] + w[3]) / 2 - y_mid) < 7]
        val_rect = None
        for v_str, v_clean in target_values:
            for w in row_words:
                w_text = w[4].strip()
                w_clean = w_text.rstrip("0").rstrip(".") if "." in w_text else w_text
                if v_clean == w_clean or v_str == w_text:
                    val_rect = fitz.Rect(w[0] - 2, w[1] - 1, w[2] + 2, w[3] + 1)
                    break
            if val_rect:
                break
        print(f"  val_rect: {val_rect}")
        if val_rect:
            val_text = [w[4] for w in words if fitz.Rect(w[:4]).intersects(val_rect)]
            print(f"  Highlighted value text: {val_text}")

print("--- Supply Ramp time ---")
highlight_test("*Supply Ramp ti me tr - Time to reach minimum supply voltage", "supply_ramp_time", "Supply Ramp Time", val="", max_val="125.0")

print("\n--- Startup Peak Battery Drain ---")
highlight_test("*Startup Peak Battery Dr ain Ipk", "startup_peak_current", "Startup Peak Battery Drain", val="150.0", max_val="200.0")
