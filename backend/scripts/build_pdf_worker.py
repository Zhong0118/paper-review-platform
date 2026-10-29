"""Build only the PDF worker; never send the backend's .env/storage to Docker."""
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
import subprocess


def main():
    backend = Path(__file__).resolve().parents[1]
    with TemporaryDirectory(prefix='paper-review-worker-build-') as directory:
        context = Path(directory)
        worker = context / 'app/modules/files/transform_worker.py'
        worker.parent.mkdir(parents=True)
        copyfile(backend / 'app/modules/files/transform_worker.py', worker)
        copyfile(backend / 'pdf-worker/Dockerfile', context / 'Dockerfile')
        subprocess.run(['docker', 'build', '--pull=false', '-t', 'paper-review-pdf-worker:6.19.0', str(context)], check=True)


if __name__ == '__main__':
    main()
