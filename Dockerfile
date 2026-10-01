FROM python:3.12-alpine
WORKDIR /app
COPY server.py store.js index.html prompt.html sw.js manifest.webmanifest icon.svg ./
ENV AIO_DATA=/data AIO_PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["python3", "-u", "server.py"]
