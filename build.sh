#!/bin/bash
set -o nounset
set -o errexit

cd `dirname $0`/service

$DOTFILES/commands/docker-require.sh redis markdown-redis
go build api.go

./api &
sleep 1
./api-test.sh

killall -9 api
