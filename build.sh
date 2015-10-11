#!/bin/bash


verbose="false"
if [[ "$1" == "-v" ]]; then
  verbose="true"
fi

set -o errexit
set -o nounset

cd `dirname $0`/service

$DOTFILES/commands/docker-require.sh redis markdown-redis
go build api.go

killall -9 api 2</dev/null || echo ''

echo "api test cycle {{{ "
echo ""
if [[ "$verbose" == "true" ]]; then
  ./api &
else
  ./api 2>/dev/null &
fi

sleep 1
./api-test.sh
killall -9 api
echo ""
echo "}}}"
echo ""

# development process
./api
