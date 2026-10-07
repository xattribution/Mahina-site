FROM python:3.12-slim
WORKDIR /srv/mahina
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 MAHINA_DATA=/data FORWARDED_ALLOW_IPS=127.0.0.1 MAHINA_UID=10001
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && groupadd -r -g 10001 mahina && useradd -r -u 10001 -g mahina -d /data -s /usr/sbin/nologin mahina
COPY app ./app
COPY web ./web
COPY seed ./seed
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4)"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--no-server-header"]
