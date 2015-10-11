#!/bin/bash


verbose="false"
if [[ "$1" == "-v" ]]; then
  verbose="true"
fi

set -o errexit
set -o nounset

cd `dirname $0`/service

dockerrequire="$DOTFILES/commands/docker-require.sh"
$dockerrequire redis markdown-redis
$dockerrequire mysql markdown-mysql


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
