#!/usr/bin/env python3
"""Package reproducible source, without compiled dependencies, host identity or secrets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
destination = root / 'dist/downloads/courbure-starter.zip'
destination.parent.mkdir(parents=True, exist_ok=True)
directories = ('web', 'server', 'scripts', 'tests', 'docs', '.github')
files = ('README.md', 'CODEX_HANDOFF.md', 'CONTRIBUTING.md', 'LICENSE', 'NOTICE',
         'package.json', 'package-lock.json', '.gitignore')
paths = [root / name for name in files if (root / name).is_file()]
for directory in directories:
    folder = root / directory
    if not folder.is_dir():
        continue
    for path in folder.rglob('*'):
        relative = path.relative_to(root)
        if any(part in ('.git', '.openai', '.build', 'node_modules', '__pycache__')
               or part.startswith('.env') for part in relative.parts):
            continue
        if directory == 'dist' and len(relative.parts) > 1 and relative.parts[1] in ('server', 'downloads'):
            continue
        if path.suffix in ('.pyc', '.zip', '.gz'):
            continue
        if path.is_symlink():
            raise RuntimeError('Source packages may not contain symbolic links.')
        if path.is_file():
            paths.append(path)
with ZipFile(destination, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(set(paths)):
        archive.write(path, 'courbure/' + path.relative_to(root).as_posix())
print(f'Packaged {len(set(paths))} redistributable files; hosting identity and credentials excluded.')
