FROM node:latest

RUN npm install -g browserify myth watchman
RUN apt-get update && apt-get install vim -y

WORKDIR /src
VOLUME /src

EXPOSE 8080
EXPOSE 5000

CMD ["bash", "-c", "./markdown"]
