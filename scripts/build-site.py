"""
Builds the product site into site/. Run from the repository root: python3 scripts/build-site.py

The pages, text and layout live in scripts/site_build/, the guides in scripts/guides/<lang>/, and
every address in site.config.json. The Worker in tools/site serves site/ (tools/site/README.md).
Standard library only, so Workers Builds needs nothing installed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from site_build.build import main  # noqa: E402

if __name__ == '__main__':
    main()
