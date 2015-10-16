#!/bin/bash

cd $(dirname $0)/..

docker exec markdown-app ./app/build.sh /src/app/dist

# docker stop markdown-proxy
# docker restart markdown-proxy
exit
