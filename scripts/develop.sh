#!/bin/bash

set -o errexit

cd `dirname $0`/..

docker kill markdown-redis || echo 'skipping'
docker rm markdown-redis || echo 'skipping'
docker kill markdown-mysql || echo 'skipping'
docker rm markdown-mysql || echo 'skipping'
docker kill markdown-develop || echo 'skipping'
docker rm markdown-develop || echo 'skipping'

./docker-require.sh redis markdown-redis
./docker-require.sh mysql markdown-mysql


go build api.go

docker run alpine --name="markdown-develop" mkdir /ctx
docker cp ./. markdown-develop:/app
# image=`docker commit $id`
# docker run $image bash
