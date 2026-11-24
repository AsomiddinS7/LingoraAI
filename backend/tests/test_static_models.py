from fastapi.testclient import TestClient
from app.config import get_settings
from app.main import create_app

def test_replacing_a_fixed_model_filename_does_not_leave_a_week_of_stale_cache(tmp_path,monkeypatch):
    (tmp_path/'index.html').write_text('<html>Lingora</html>')
    (tmp_path/'model').mkdir();model=tmp_path/'model/trained-sign-model.json';model.write_text('{"version":1}')
    (tmp_path/'assets').mkdir();(tmp_path/'assets/app-abcd.js').write_text('void 0;')
    monkeypatch.setattr(get_settings(),'static_dir',str(tmp_path))
    client=TestClient(create_app())
    first=client.get('/model/trained-sign-model.json')
    assert first.status_code==200 and first.headers['cache-control']=='no-cache'
    model.write_text('{"version":2}')
    assert client.get('/model/trained-sign-model.json').json()=={'version':2}
    assert 'immutable' in client.get('/assets/app-abcd.js').headers['cache-control']
