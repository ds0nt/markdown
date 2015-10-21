#!/bin/bash

cd $(dirname $0)/..

go build api.go
docker kill markdown-app 2>/dev/null
docker rm markdown-app 2>/dev/null

docker build -t markdown-app .
docker run -d\
          -P \
          -v `pwd`:/src \
          --link=markdown-redis:markdown-redis \
          --link=markdown-mysql:markdown-mysql \
          --name=markdown-app \
          markdown-app

docker exec markdown-app bash -c 'cd app && watchman src ./build.sh'
 "$(dirname $0)/src" build $output

# docker stop markdown-proxy
# docker restart markdown-proxy
exit
