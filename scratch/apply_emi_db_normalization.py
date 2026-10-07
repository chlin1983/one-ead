import sqlite3

conn = sqlite3.connect('modules/component_database/data/components.db')
c = conn.cursor()

# Remove old/incomplete EMI rows
c.execute("DELETE FROM specs WHERE param_key LIKE '%emi%' OR param_label LIKE '%emi%'")

new_emi_specs = [
    # MM60
    ('knowles_mm60_63230', 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI Noise 0.7-0.96 GHz', '7.0', None, None, 'dB SPL', '@ 90 V/m (IEC 60118-13)', 2),
    ('knowles_mm60_63230', 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI Noise 1.4-2.0 GHz', '1.0', None, None, 'dB SPL', '@ 50 V/m', 2),
    ('knowles_mm60_63230', 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI Noise 2.0-2.7 GHz', '1.0', None, None, 'dB SPL', '@ 35 V/m', 2),

    # MM08
    ('knowles_mm08_36139', 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI Noise 0.7-0.96 GHz', 'TBD', None, 'TBD', 'dB SPL', '@ 90 V/m (IEC 60118-13)', 2),
    ('knowles_mm08_36139', 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI Noise 1.4-2.0 GHz', 'TBD', None, 'TBD', 'dB SPL', '@ 50 V/m', 2),
    ('knowles_mm08_36139', 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI Noise 2.0-2.7 GHz', 'TBD', None, 'TBD', 'dB SPL', '@ 35 V/m', 2),

    # MM20
    ('knowles_mm20_62249', 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI 0.70-0.96 GHz 90 V/m', '25.0', None, '25.0', 'dB SPL', '90 V/m (IEC 60118-13)', 2),
    ('knowles_mm20_62249', 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI 1.4-2.0 GHz 50 V/m', '15.0', None, '15.0', 'dB SPL', '@ 50 V/m', 2),
    ('knowles_mm20_62249', 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI 2.0-2.7 GHz 35V/m', '15.0', None, '15.0', 'dB SPL', '@ 35 V/m', 2),
]

for comp_id, p_key, p_lbl, nom, min_v, max_v, unit, cond, page in new_emi_specs:
    c.execute("""
        INSERT INTO specs (component_id, param_key, param_label, nom_val, min_val, max_val, unit, condition, source_page)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (comp_id, p_key, p_lbl, nom, min_v, max_v, unit, cond, page))

conn.commit()
print(f'Successfully normalized {len(new_emi_specs)} EMI specs in components.db.')

# Verify
rows = c.execute("SELECT component_id, param_key, param_label, nom_val, condition FROM specs WHERE param_key LIKE '%emi%' ORDER BY param_key, component_id").fetchall()
for r in rows:
    print(' ', r)
conn.close()
