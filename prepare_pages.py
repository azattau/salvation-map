"""Produce the /docs publishing folder without runtime data or private files."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent
target = root / 'docs'
# Only copy the self-contained frontend; original uploads never enter the publishing tree.
shutil.copytree(root / 'dist', target, dirs_exist_ok=True)
(target / '.nojekyll').touch()
print('GitHub Pages files ready in docs/')
