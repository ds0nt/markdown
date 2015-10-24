#!/bin/bash
source $(dirname $0)/docker-alpha.sh

cd $(dirname $0)/..

can_base .docker

can_container markdown-mysql orchardup/mysql
can_environment MYSQL_DATABASE markdown-mysql
can_volume "/data"
can_dae
mysql_port=$(can_i_have_port 3306)


can_container markdown-redis redis
can_volume "/data"
can_dae
redis_port=$(can_i_have_port 6379)


docker kill markdown-app 2>/dev/null
docker rm markdown-app 2>/dev/null

go build .
docker build -t markdown-app .
docker run -d\
          -P \
          -v `pwd`:/src \
          --link=markdown-redis:markdown-redis \
          --link=markdown-mysql:markdown-mysql \
          --name=markdown-app \
          markdown-app


http_port=$(docker port markdown-app 8080 | cut -d: -f2)
api_port=$(docker port markdown-app 5000 | cut -d: -f2)
echo $http_port
echo $api_port

docker kill markdown-proxy 2>/dev/null
docker rm markdown-proxy 2>/dev/null

docker run --restart=always -d \
         -v "`pwd`/scripts":/usr/local/etc/haproxy \
         --link=markdown-app:markdown-app \
         -p 80:80     \
         -p 5000:5000 \
         --name="markdown-proxy" \
         haproxy


docker exec markdown-app bash -c 'cd app && watchman src ./build.sh'
