import urllib.request
import fitz

url1 = 'http://127.0.0.1:8100/api/component_database/datasheet-file/microphone/D00343759_V2_DATA%20SHEET%20MIC%20MM60-63230-B66%20KNOWLES.pdf?param=supply_ramp_time&label=Supply%20Ramp%20Time&raw=*Supply%20Ramp%20ti%20me%20tr%20-%20Time%20to%20reach%20minimum%20supply%20voltage&max=125.0&page=4'
print('Fetching Supply Ramp Time...')
req1 = urllib.request.Request(url1)
with urllib.request.urlopen(req1) as resp:
    data1 = resp.read()

doc1 = fitz.open(stream=data1, filetype='pdf')
p1 = doc1[3]
annots1 = list(p1.annots())
print('Supply Ramp Time - Annotations on Page 4:', len(annots1))
for a in annots1:
    words = [w[4] for w in p1.get_text('words') if fitz.Rect(w[:4]).intersects(a.rect)]
    print('  Annot text:', ' '.join(words), 'Rect:', a.rect)

url2 = 'http://127.0.0.1:8100/api/component_database/datasheet-file/microphone/D00343759_V2_DATA%20SHEET%20MIC%20MM60-63230-B66%20KNOWLES.pdf?param=startup_peak_current&label=Startup%20Peak%20Battery%20Drain&raw=*Startup%20Peak%20Battery%20Dr%20ain%20Ipk&val=150.0&max=200.0&page=4'
print('\nFetching Startup Peak Battery Drain...')
req2 = urllib.request.Request(url2)
with urllib.request.urlopen(req2) as resp:
    data2 = resp.read()

doc2 = fitz.open(stream=data2, filetype='pdf')
p2 = doc2[3]
annots2 = list(p2.annots())
print('Startup Peak Battery Drain - Annotations on Page 4:', len(annots2))
for a in annots2:
    words = [w[4] for w in p2.get_text('words') if fitz.Rect(w[:4]).intersects(a.rect)]
    print('  Annot text:', ' '.join(words), 'Rect:', a.rect)
