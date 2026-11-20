"""Exercise real profile pages, session export and offline navigation at a Pages subpath.

Run with Python and Playwright installed: python tests/test_pwa.py
Optional environment variables: CHROMIUM_EXECUTABLE, WEBKIT_EXECUTABLE, LAB_SCREENSHOTS.
Only a temporary browser profile and synthetic text are used.
"""
import json
import os
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PREFIX = '/ios-pwa-lab/'
PROFILES = ('padrao', 'translucido')
SECRET = 'Private editor text 8219 MUST NOT be in reports'
RESERVED = 'other-app:not-for-recorder'


class LabFiles(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if getattr(self.server, 'unavailable', False):
            return self.send_error(503)
        if not self.path.startswith(PREFIX):
            return self.send_error(404)
        self.path = '/' + self.path[len(PREFIX):]
        try:
            return super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass


def save_screenshot(page, name):
    directory = os.getenv('LAB_SCREENSHOTS')
    if directory:
        Path(directory).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(directory) / (name + '.png')))


def check_install_metadata(page, url, profile):
    doc = page.evaluate("""() => ({
        manifest: document.querySelector('link[rel="manifest"]').href,
        mode: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content ?? null,
        mobile: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
        fit: document.querySelector('meta[name="viewport"]')?.content,
        title: document.title,
        build: document.querySelector('meta[name="app-version"]')?.content
    })""")
    assert doc['mobile'] == 'yes' and 'viewport-fit=cover' in doc['fit']
    assert doc['mode'] == ('black-translucent' if profile == 'translucido' else None)
    assert doc['build']
    manifest = page.evaluate('async url => (await fetch(url)).json()', doc['manifest'])
    scope = urljoin(doc['manifest'], manifest['scope'])
    start = urljoin(doc['manifest'], manifest['start_url'])
    assert scope == url and start.startswith(scope)
    assert manifest['display'] == 'standalone' and manifest['icons']
    return urljoin(doc['manifest'], manifest['id']), scope, doc['build']


def assert_geometry(page, width):
    geometry = page.evaluate("""() => {
        const rect = id => {
          const {top, left, right, bottom, width, height} = document.querySelector(id).getBoundingClientRect();
          return {top, left, right, bottom, width, height};
        };
        return {doc: document.documentElement.scrollWidth, height: window.innerHeight,
                aura:rect('#aura'), dock:rect('#dock')};
    }""")
    aura, dock = geometry['aura'], geometry['dock']
    assert geometry['doc'] <= width + 1, geometry
    assert abs(aura['top']) <= 1 and abs(aura['width'] - width) <= 1, geometry
    assert abs(aura['height'] - geometry['height']) <= 2, geometry
    assert 0 <= dock['left'] < dock['right'] <= width + 1 and 0 < dock['bottom'] <= geometry['height'] + 1, geometry
    return geometry


def select_profile(page, base, profile):
    link = page.locator('a').evaluate_all(r"""(links, target) => links.find(
       link => new URL(link.href).pathname.replace(/index\.html$/, '').replace(/\/$/, '') === target
    )?.getAttribute('href')""", urlsplit(base + profile).path)
    assert link, profile
    page.locator(f'a[href="{link}"]').first.click()
    page.wait_for_function('window.LabRecorder && window.LabRecorder.listSessions().length > 0')


def exercise_trip(page, url, profile, build):
    # Read the served HTML before its scripts run. The iOS host can consult
    # this head before JS and CSS create any in-page chrome.
    for name, mode in [('estudo', None), ('anotacoes', 'black-translucent')]:
        head = page.evaluate('''async url => {
          const response = await fetch(url);
          const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
          return {page:doc.documentElement.dataset.page, profile:doc.documentElement.dataset.profile,
            mode:doc.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content ?? null,
            manifest:new URL(doc.querySelector('link[rel="manifest"]').getAttribute('href'), url).href,
            fit:doc.querySelector('meta[name="viewport"]').content,
            theme:doc.querySelector('meta[name="theme-color"]').content};
        }''', url + name + '.html')
        assert head['page'] == name and head['profile'] == profile and head['mode'] == mode, head
        assert head['manifest'] == url + 'manifest.webmanifest' and 'viewport-fit=cover' in head['fit'], head
        if name == 'estudo':
            control_color = head['theme']
        else:
            assert head['theme'] == control_color

    def assert_step(name, phase):
        page.wait_for_function('phase => window.TrialRecorder?.getState().phase === phase', arg=phase)
        assert urlsplit(page.url).path == urlsplit(url + name + '.html').path
        assert page.evaluate('navigator.serviceWorker.controller?.scriptURL') == url + 'sw.js'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')

    page.locator('a[href*="estudo.html?iniciar=1"]').first.click()
    assert_step('estudo', 'studyBefore')
    trip_id = page.evaluate('TrialRecorder.getReport().tripId')
    page.locator('[data-trip-observation="separada"]').click()
    page.locator('[data-trip-next]').click()
    assert_step('anotacoes', 'notes')
    assert page.locator('#aura canvas').is_visible()
    page.locator('[data-trip-observation="aura-no-relogio"]').click()
    page.reload()
    assert_step('anotacoes', 'notes')
    assert page.evaluate('TrialRecorder.getReport().visits.at(-1).observation.value') == 'aura-no-relogio'
    if profile == 'padrao':
        page.locator('[data-trip-next]').click()
    else:
        page.go_back()
    assert_step('estudo', 'studyAfter')
    page.locator('[data-trip-observation="separada"]').click()
    page.locator('[data-trip-share]').click()
    page.wait_for_function('id => window.qaShared?.tripId === id', arg=trip_id)
    with page.expect_download() as download:
        page.locator('[data-trip-download]').click()
    report = json.loads(Path(download.value.path()).read_text())
    assert report['type'] == 'ios-pwa-lab-percurso' and report['tripId'] == trip_id
    assert report['profile'] == profile and report['build'] == build
    visits = report['visits']
    assert [(v['phase'], v['observation']['value']) for v in visits] == [
        ('studyBefore', 'separada'), ('notes', 'aura-no-relogio'), ('studyAfter', 'separada')], visits
    assert [v['arrival']['statusBarStyle'] for v in visits] == [None, 'black-translucent', None]
    assert all(v['observation']['view']['innerHeight'] > 0 for v in visits)
    assert visits[1]['observation']['view']['auraPhase'] is not None
    if profile == 'padrao':
        assert all(v['arrival']['standalone'] for v in visits)
    assert page.evaluate('qaShared.visits.map(v=>v.id)') == [v['id'] for v in visits]
    assert RESERVED not in json.dumps(report) and SECRET not in json.dumps(report)
    assert page.evaluate('TrialRecorder.getState().completed')
    save_screenshot(page, f'{profile}-trip-complete')
    page.locator('[data-trip-new]').click()
    assert_step('estudo', 'studyBefore')
    fresh = page.evaluate('TrialRecorder.getReport()')
    assert fresh['tripId'] != trip_id and len(fresh['visits']) == 1
    assert fresh['visits'][0]['observation'] is None
    return trip_id


def check(engine, executable, base, server):
    origin = urlsplit(base).netloc
    with TemporaryDirectory(prefix='ios-pwa-lab-qa-') as work:
        context = engine.launch_persistent_context(
            work, executable_path=executable, headless=True,
            args=['--no-sandbox'] if engine.name == 'chromium' else [],
            viewport={'width': 430, 'height': 873}, is_mobile=True, has_touch=True,
            accept_downloads=True)
        # The native share sheet belongs to iOS. Capture the File handed to it
        # so CI exercises the same UI handler without opening a system dialog.
        context.add_init_script("""(() => {
          if (location.pathname.includes('/padrao/')) {
            Object.defineProperty(navigator, 'standalone', {value: true});
          }
          Object.defineProperty(navigator, 'canShare', {value: data => data.files?.length === 1});
          Object.defineProperty(navigator, 'share', {value: async data => {
            window.qaShared = JSON.parse(await data.files[0].text());
          }});
        })()""")
        errors, external = [], []
        context.on('request', lambda req: external.append(req.url) if req.url.startswith(('https:', 'http:')) and urlsplit(req.url).netloc != origin else None)
        page = context.pages[0] if context.pages else context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(7000)
        page.goto(base)
        page.evaluate("""async key => {
          localStorage.setItem(key, 'other-app-secret-9120');
          const cache = await caches.open('other-cache-qa');
          await cache.put('./sentinel-response', new Response('kept'));
        }""", RESERVED)
        identities = set()
        trip_ids = set()
        geometries = {}
        for profile in PROFILES:
            page.goto(base)
            select_profile(page, base, profile)
            url = base + profile + '/'
            identity, scope, build = check_install_metadata(page, url, profile)
            assert identity not in identities
            identities.add(identity)
            page.wait_for_function('navigator.serviceWorker.controller && window.LabOffline?.state === "ready"')
            registration = page.evaluate('async () => (await navigator.serviceWorker.ready).scope')
            assert registration == scope, (registration, scope)
            page.wait_for_function("getComputedStyle(document.querySelector('#dock')).position !== 'static'")
            for width, height in ((430, 873), (320, 568)):
                page.set_viewport_size({'width': width, 'height': height})
                geometry = assert_geometry(page, width)
                if width in geometries:
                    assert geometry == geometries[width], (profile, width, geometry, geometries[width])
                geometries[width] = geometry
                save_screenshot(page, f'{engine.name}-{profile}-{width}')
            page.set_viewport_size({'width': 430, 'height': 873})
            run_id = exercise_recording(page, profile, build)
            page.evaluate('LabRecorder.flush()')
            # WPE WebKit's simulated offline flag can abort a navigation before
            # dispatch to the service worker. Take the HTTP origin offline on
            # both engines and use Chromium's network disconnect as well.
            server.unavailable = True
            if engine.name == 'chromium':
                context.set_offline(True)
            try:
                page.reload(wait_until='load')
                page.wait_for_function('Boolean(window.LabRecorder && navigator.serviceWorker.controller)')
                assert_geometry(page, 430)
                archived = page.evaluate('id => LabRecorder.getReport(id)', run_id)
                assert archived and archived['sessionId'] == run_id and SECRET not in json.dumps(archived)
                page.locator('#reports').click()
                page.locator('#session-select').select_option(run_id)
                with page.expect_download() as download:
                    page.locator('#download').click()
                assert json.loads(Path(download.value.path()).read_text())['sessionId'] == run_id
                page.locator('#panel-close').click()
                assets = page.evaluate("""async () => {
                  const srcs = [...document.querySelectorAll('script[src],link[rel="stylesheet"],link[rel="manifest"]')]
                    .map(node => node.src || node.href);
                  return Promise.all(srcs.map(async src => [src, (await fetch(src)).status]));
                }""")
                assert all(code == 200 for _, code in assets), assets
                if trip_ids:
                    other_id = next(iter(trip_ids))
                    page.goto(url + 'anotacoes.html?percurso=' + other_id)
                    page.wait_for_function('window.TrialRecorder?.getState().phase === "untracked"')
                    isolated = page.evaluate('TrialRecorder.getReport()')
                    assert isolated['profile'] == profile and all(not v['observation'] for v in isolated['visits'])
                    page.goto(url)
                trip_id = exercise_trip(page, url, profile, build)
                assert trip_id not in trip_ids
                trip_ids.add(trip_id)
            finally:
                server.unavailable = False
                if engine.name == 'chromium':
                    context.set_offline(False)
        assert page.evaluate("key => localStorage.getItem(key)", RESERVED) == 'other-app-secret-9120'
        assert page.evaluate("""async () => (await (await caches.open('other-cache-qa'))
            .match(new URL('../sentinel-response', location.href))).text()""") == 'kept'
        assert not external, external
        assert not errors, errors
        context.close()
        return {'engine': engine.name, 'profiles': len(identities), 'offline': True}


def exercise_recording(page, profile, build):
    page.locator('#tools').click()
    page.locator('#theme-dark').click()
    page.locator('#corners-square').click()
    assert page.locator('html').get_attribute('data-theme') == 'dark'
    assert page.locator('html').get_attribute('data-corners') == 'square'
    page.locator('#device-settings summary').click()
    page.locator('#device-model').fill('QA iPhone')
    page.locator('#device-os').fill('27.2')
    page.locator('#save-device').click()
    if page.locator('#panel-close').is_visible():
        page.locator('#panel-close').click()

    page.locator('#editor').fill(SECRET)
    page.locator('#editor').evaluate('el => el.blur()')
    page.locator('#mark').click()
    page.locator('[data-observation="Linha atrás da hora"]').click()
    page.wait_for_function('LabRecorder.getReport().observations.length > 0')
    page.evaluate('LabRecorder.flush()')
    report = page.evaluate('LabRecorder.getReport()')
    data = json.dumps(report, ensure_ascii=False)
    assert report['profile'] == profile and report['build'] == build
    assert report['device']['model'] == 'QA iPhone' and report['device']['os'] == '27.2'
    assert report['baseline'] and report['observations'][-1]['observation'] == 'Linha atrás da hora'
    assert report['observations'][-1]['snapshot']
    assert 'other-app-secret-9120' not in data and RESERVED not in data and SECRET not in data
    page.locator('#reports').click()
    page.locator('#share').click()
    page.wait_for_function('window.qaShared?.sessionId === LabRecorder.getReport().sessionId')
    with page.expect_download() as download:
        page.locator('#download').click()
    exported = json.loads(Path(download.value.path()).read_text())
    assert exported['sessionId'] == report['sessionId'] and exported['observations'] == report['observations']
    assert SECRET not in json.dumps(exported)
    page.locator('#panel-close').click()
    return report['sessionId']


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), LabFiles)
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}{PREFIX}'
    try:
        with sync_playwright() as playwright:
            chromium = os.getenv('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
            print(json.dumps(check(playwright.chromium, chromium, base, server)), flush=True)
            if os.getenv('WEBKIT_EXECUTABLE'):
                print(json.dumps(check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], base, server)), flush=True)
    finally:
        server.shutdown()
