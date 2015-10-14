FROM ubuntu

WORKDIR /app

EXPOSE 8080
EXPOSE 5000

VOLUME /app

CMD ["bash", "-c", "./markdown"]
