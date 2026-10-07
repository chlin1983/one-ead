import sqlite3

conn = sqlite3.connect('modules/component_database/data/components.db')
c = conn.cursor()

# Update MM07 sensitivity_@30hz to canonical key sensitivity_30hz and label Sensitivity @ 30 Hz
c.execute("""
    UPDATE specs
    SET param_key = 'sensitivity_30hz', param_label = 'Sensitivity @ 30 Hz'
    WHERE component_id = 'knowles_mm07_62964_b66' AND (param_key = 'sensitivity_@30hz' OR param_key = 'sensitivity_30hz')
""")

# Update MM20 sensitivity_peak label to Sensitivity Peak 1 kHz
c.execute("""
    UPDATE specs
    SET param_key = 'sensitivity_peak', param_label = 'Sensitivity Peak 1 kHz'
    WHERE component_id = 'knowles_mm20_62249' AND param_key = 'sensitivity_peak'
""")

conn.commit()
print("Updated sensitivity specs in components.db:")
rows = c.execute("SELECT component_id, param_key, param_label, nom_val, unit, condition, source_page FROM specs WHERE param_key IN ('sensitivity_30hz', 'sensitivity_peak')").fetchall()
for r in rows:
    print(' ', r)
conn.close()
