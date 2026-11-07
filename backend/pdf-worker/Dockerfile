FROM python:3.12-alpine@sha256:92abd2ba1bdfb48b1e2ac224b582dd1558d0d4bb11c903b126b5bf9c448fd656
RUN pip install --no-cache-dir pypdf==6.19.0
COPY app/modules/files/transform_worker.py /worker.py
USER 65534:65534
ENTRYPOINT ["python", "-I", "-B", "/worker.py"]
