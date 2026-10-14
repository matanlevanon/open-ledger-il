"""
The site config. Every address the site links to lives in site.config.json at the repository root,
so a fork changes one file.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / 'site'


def load_config():
    path = ROOT / 'site.config.json'
    if not path.exists():
        sys.exit('site.config.json is missing. Copy it from the repository and set siteUrl.')
    cfg = json.loads(path.read_text(encoding='utf-8'))
    if not str(cfg.get('siteUrl', '')).startswith('https://'):
        sys.exit('site.config.json: set siteUrl to the site address, starting with https://.')
    if not str(cfg.get('repoUrl', '')).startswith('https://'):
        sys.exit('site.config.json: set repoUrl to the GitHub repository address.')
    for key in ('siteUrl', 'repoUrl', 'demoUrl', 'shopUrl', 'contactEndpoint'):
        cfg[key] = str(cfg.get(key, '')).rstrip('/')
    cfg['shopLive'] = bool(cfg.get('shopLive'))
    cfg['analytics'] = cfg.get('analytics') or {}
    return cfg


CONFIG = load_config()
SITE_URL = CONFIG['siteUrl']
REPO_URL = CONFIG['repoUrl']
DEMO_URL = CONFIG['demoUrl']
SHOP_URL = CONFIG['shopUrl']
# The ₪99 card shows only when the shop is live. Set shopLive once the shop's buy page works,
# and uncomment the ₪99 paragraph in README.md.
SHOP_LIVE = CONFIG['shopLive']
CONTACT_ENDPOINT = CONFIG['contactEndpoint']
ANALYTICS = CONFIG['analytics']

REPO = REPO_URL
DEPLOY = f'{REPO_URL}/blob/main/docs/deploy.md'
SETUP = f'{REPO_URL}/blob/main/docs/setup.md'
LICENSE = f'{REPO_URL}/blob/main/LICENSE'
ITA_REGISTRY = 'https://www.gov.il/he/service/itc-software-registry-for-computerized-accounting-systems'
ITA_REG = 'https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system'
CLONE = f'git clone {REPO_URL}.git'
# The version shown on the site comes from package.json, so a release bump updates it.
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
CERTIFICATE = '281801'
