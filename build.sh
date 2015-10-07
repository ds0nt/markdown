#!/bin/bash
set -o nounset
set -o errexit

cd `dirname $0`
go build .
./markdown
