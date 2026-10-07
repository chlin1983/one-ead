with open("modules/small_tools/web/excalidraw/assets/index-cBv2hH7p.js", "r", encoding="utf-8") as f:
    text = f.read()

idx = text.find('displayName="Socials"')
if idx == -1:
    idx = text.find('Socials')
print("Position:", idx)
print(text[max(0, idx - 400): min(len(text), idx + 400)])
