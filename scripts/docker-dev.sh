#!/bin/bash

cd $(dirname $0)/..


go build .
./app/develop.sh
source scripts/docker-alpha.sh
cp -urv config.yml markdown app .docker/markdown-app/app
docker restart markdown-app
docker restart markdown-proxy
./scripts/api-test.sh
exit
