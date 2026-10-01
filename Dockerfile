FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html prompt.html sw.js manifest.webmanifest icon.svg /usr/share/nginx/html/
EXPOSE 80
