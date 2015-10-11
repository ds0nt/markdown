#!/bin/bash

set -o errexit

cd `dirname $0`/service

dockerrequire="$DOTFILES/commands/docker-require.sh"
$dockerrequire redis markdown-redis
$dockerrequire mysql markdown-mysql


go build api.go

killall -9 api 2</dev/null || echo ''

echo "api test cycle {{{ "
echo ""

if [[ "$DEBUG" == "api" ]]; then
  ./api &
else
  ./api 2>/dev/null 1>/dev/null &
fi

sleep 1
./api-test.sh
echo ""
echo "}}}"
echo ""
