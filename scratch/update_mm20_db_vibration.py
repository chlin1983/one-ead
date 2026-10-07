import sqlite3

conn = sqlite3.connect('modules/component_database/data/components.db')
c = conn.cursor()

c.execute("""
    UPDATE specs
    SET param_key = 'input_referred_vibration_1_khz_blocked_port',
        param_label = 'Input Referred Vibration'
    WHERE id = 245
""")

c.execute("""
    UPDATE specs
    SET param_key = 'input_referred_vibration_1_khz_open_port',
        param_label = 'Input Referred Vibration'
    WHERE id = 246
""")

conn.commit()

print("Updated MM20 vibration specs:")
for r in c.execute("SELECT id, param_key, param_label, nom_val, condition FROM specs WHERE id IN (245, 246)").fetchall():
    print(r)
