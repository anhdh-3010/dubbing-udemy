FROM python:3.12-slim

# HOST=0.0.0.0 here is deliberate, not a leftover from before app.py's own
# default changed to 127.0.0.1 (spec 4.2/8.1). Docker's `-p host:container`
# forwards a connection arriving at the HOST's published address to the
# CONTAINER's own network interface, never to the container's loopback, so
# a server bound only to 127.0.0.1 in here would be unreachable through any
# port mapping at all — including a correctly loopback-restricted one. The
# security boundary app.py's change protects lives on the HOST side of the
# mapping instead: see docker-compose.yml's `127.0.0.1:8770:8770` publish
# line. A bare `docker run -p 8770:8770` (omitting the host IP) publishes
# to every interface on the host and must not be used; always publish as
# `-p 127.0.0.1:8770:8770`, or run via docker-compose, which already does.
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    HOST=0.0.0.0 \
    PORT=8770

WORKDIR /app
COPY requirements.txt .
# Installs the exact pins requirements.txt declares (vieneu, fastapi,
# uvicorn, numpy, pydantic) instead of only vieneu==3.8.1 and leaving pip
# free to resolve the rest as whatever transitive versions land that day —
# requirements.txt's own header calls an unpinned transitive dependency
# "not a promise", and installing from vieneu alone was exactly that.
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8770

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8770/health')" || exit 1

CMD ["python", "app.py"]
