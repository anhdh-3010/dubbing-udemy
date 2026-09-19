FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    HOST=0.0.0.0 \
    PORT=8770

RUN pip install --no-cache-dir vieneu==3.8.1

WORKDIR /app
COPY app.py .

EXPOSE 8770

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8770/health')" || exit 1

CMD ["python", "app.py"]
